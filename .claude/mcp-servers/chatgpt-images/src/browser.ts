import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SELECTORS, URLS } from './selectors.js';

export type AspectRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16';

const ASPECT_TO_DALLE: Record<AspectRatio, { w: number; h: number; label: string }> = {
  '1:1': { w: 1024, h: 1024, label: '1024x1024 (square)' },
  // У DALL-E внутри ChatGPT нет нативных 3:2/2:3 — маппим на ближайшие 16:9 / 9:16.
  '3:2': { w: 1792, h: 1024, label: '1792x1024 (landscape)' },
  '2:3': { w: 1024, h: 1792, label: '1024x1792 (portrait)' },
  '16:9': { w: 1792, h: 1024, label: '1792x1024 (landscape)' },
  '9:16': { w: 1024, h: 1792, label: '1024x1792 (portrait)' },
};

export class CaptchaError extends Error {
  constructor(msg = 'manual login required: Cloudflare challenge or captcha detected') {
    super(msg);
    this.name = 'CaptchaError';
  }
}

export class RateLimitError extends Error {
  constructor(msg = 'rate limit hit') {
    super(msg);
    this.name = 'RateLimitError';
  }
}

export interface BrowserOptions {
  storageStatePath: string;
  headless?: boolean;
}

export class ChatGPTBrowser {
  private browser: Browser | null = null;
  private ctx: BrowserContext | null = null;
  constructor(private readonly opts: BrowserOptions) {}

  async start() {
    if (this.browser) return;
    if (!existsSync(this.opts.storageStatePath)) {
      throw new Error(
        `storageState не найден: ${this.opts.storageStatePath}. Запусти "npm run auth".`,
      );
    }
    this.browser = await chromium.launch({
      headless: this.opts.headless ?? false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.ctx = await this.browser.newContext({
      storageState: this.opts.storageStatePath,
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
  }

  async stop() {
    await this.ctx?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.ctx = null;
    this.browser = null;
  }

  /**
   * Сгенерировать одну картинку. Возвращает абсолютный путь сохранённого PNG.
   * Может бросить CaptchaError / RateLimitError / generic Error.
   */
  async generate(prompt: string, aspect: AspectRatio, outputPath: string): Promise<string> {
    if (!this.ctx) await this.start();
    const page = await this.ctx!.newPage();
    try {
      await page.goto(URLS.newChat, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      await this.ensureNoChallenge(page);
      await this.ensureLoggedIn(page);

      const dalleHint = ASPECT_TO_DALLE[aspect];
      const fullPrompt =
        `Generate an image with aspect ratio ${aspect} (${dalleHint.label}). ` +
        `Use DALL-E. ${prompt}`;

      // Снимок ID существующих картинок до отправки.
      const existingSrcs = new Set<string>(
        await page.$$eval(SELECTORS.assistantImage, (els) =>
          els.map((e) => (e as HTMLImageElement).src),
        ),
      );

      // Вставляем промпт в ProseMirror и шлём.
      await page.waitForSelector(SELECTORS.promptInput, { timeout: 30_000 });
      await page.click(SELECTORS.promptInput);
      await page.keyboard.type(fullPrompt, { delay: 8 });
      // Send button может быть disabled пока пусто — ждём активного.
      await page.waitForSelector(`${SELECTORS.sendButton}:not([disabled])`, { timeout: 15_000 });
      await page.click(SELECTORS.sendButton);

      // Ждём пока появится stop-кнопка (стрим начался) или сразу ошибка.
      await this.waitForGenerationOrError(page);

      // Ждём появления нового <img> с DALL-E результатом (до ~3 минут).
      const newSrc = await page.waitForFunction(
        (existing: string[]) => {
          const imgs = Array.from(
            document.querySelectorAll('[data-message-author-role="assistant"] img'),
          ) as HTMLImageElement[];
          // Берём первое изображение, которого не было раньше и которое полностью загрузилось.
          for (const img of imgs) {
            if (!existing.includes(img.src) && img.complete && img.naturalWidth > 256) {
              return img.src;
            }
          }
          return false;
        },
        [...existingSrcs],
        { timeout: 180_000, polling: 1000 },
      );

      const src = (await newSrc.jsonValue()) as string;
      if (!src) throw new Error('no image src extracted');

      // Тянем blob через page.evaluate + fetch (чтобы пройти cookies/auth).
      const buf = await page.evaluate(async (url: string) => {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        const ab = await r.arrayBuffer();
        return Array.from(new Uint8Array(ab));
      }, src);

      const abs = resolve(outputPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(buf));
      return abs;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async ensureNoChallenge(page: Page) {
    const challenge = await page.$(SELECTORS.cloudflareChallenge);
    if (challenge) throw new CaptchaError();
  }

  private async ensureLoggedIn(page: Page) {
    // Если видим кнопку Login — сессия слетела.
    const login = await page.$(SELECTORS.loginButton);
    if (login) {
      throw new CaptchaError(
        'manual login required: session expired. Re-run "npm run auth".',
      );
    }
  }

  private async waitForGenerationOrError(page: Page) {
    // Гонка: stop-кнопка появилась (всё ок) vs rate limit видимо vs cloudflare всплыл.
    const stopAppeared = page
      .waitForSelector(SELECTORS.stopButton, { timeout: 30_000 })
      .then(() => 'stop' as const);
    const rateLimit = page
      .waitForSelector(SELECTORS.rateLimitText, { timeout: 30_000 })
      .then(() => 'rate' as const)
      .catch(() => null);
    const winner = await Promise.race([stopAppeared, rateLimit]);
    if (winner === 'rate') throw new RateLimitError();
    await this.ensureNoChallenge(page);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseMs ?? 30_000;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e instanceof CaptchaError) throw e; // капчу не ретраим.
      if (i === retries - 1) break;
      const delay = base * Math.pow(2, i) + Math.floor(Math.random() * 5_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
