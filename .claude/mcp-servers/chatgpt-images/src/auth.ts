/**
 * CLI: открывает headful Chromium на chatgpt.com.
 * Пользователь логинится вручную, затем жмёт Enter в терминале — сохраняем storageState.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE = resolve(__dirname, '..', 'auth', 'storageState.json');

async function main() {
  mkdirSync(dirname(STORAGE), { recursive: true });
  console.log('Открываю Chromium. Залогинься в ChatGPT, дождись главного экрана.');
  console.log(`StorageState будет сохранён в: ${STORAGE}`);

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((res) =>
    rl.question('Залогинился? Жми Enter для сохранения сессии... ', () => {
      rl.close();
      res();
    }),
  );

  await ctx.storageState({ path: STORAGE });
  console.log('Готово. Сессия сохранена.');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
