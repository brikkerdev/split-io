#!/usr/bin/env node
/**
 * MCP сервер chatgpt-images.
 * stdio транспорт. Один tool: generate_image.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatGPTBrowser, CaptchaError, withRetry, type AspectRatio } from './browser.js';
import { SerialQueue } from './queue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STORAGE = resolve(ROOT, 'auth', 'storageState.json');
const LOG_DIR = resolve(ROOT, 'logs');

const HEADLESS = process.argv.includes('--headless') || process.env.CHATGPT_MCP_HEADLESS === '1';

const InputSchema = z.object({
  prompt: z.string().min(1),
  aspect_ratio: z.enum(['1:1', '3:2', '2:3', '16:9', '9:16']),
  output_path: z.string().min(1),
});

const queue = new SerialQueue();
const browser = new ChatGPTBrowser({ storageStatePath: STORAGE, headless: HEADLESS });

async function humanDelay() {
  const ms = 15_000 + Math.floor(Math.random() * 25_000);
  await new Promise((r) => setTimeout(r, ms));
}

function logLine(entry: Record<string, unknown>) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(resolve(LOG_DIR, `${day}.jsonl`), JSON.stringify(entry) + '\n');
  } catch {
    // не валим запрос из-за лога.
  }
}

const server = new Server(
  { name: 'chatgpt-images', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_image',
      description:
        'Генерирует изображение через залогиненную ChatGPT Pro сессию (DALL-E). ' +
        'Возвращает абсолютный путь сохранённого PNG. Запросы идут последовательно ' +
        'с человеческой задержкой 15-40 сек.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Описание желаемой картинки.' },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '3:2', '2:3', '16:9', '9:16'],
            description: 'Соотношение сторон. Маппится на DALL-E 1024x1024 / 1792x1024 / 1024x1792.',
          },
          output_path: {
            type: 'string',
            description: 'Куда сохранить PNG (относительно cwd либо абсолютный путь).',
          },
        },
        required: ['prompt', 'aspect_ratio', 'output_path'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'generate_image') {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const args = InputSchema.parse(req.params.arguments);

  const result = await queue.enqueue(async () => {
    const start = Date.now();
    let success = false;
    let savedPath = '';
    let errMsg = '';
    try {
      await humanDelay();
      savedPath = await withRetry(() =>
        browser.generate(args.prompt, args.aspect_ratio as AspectRatio, args.output_path),
      );
      success = true;
      return savedPath;
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
      if (e instanceof CaptchaError) {
        throw new Error(`[chatgpt-images] manual login required: ${errMsg}`);
      }
      throw new Error(`[chatgpt-images] ${errMsg}`);
    } finally {
      logLine({
        ts: new Date().toISOString(),
        prompt: args.prompt,
        aspect: args.aspect_ratio,
        output: args.output_path,
        saved: savedPath,
        durationMs: Date.now() - start,
        success,
        error: errMsg || undefined,
      });
    }
  });

  return {
    content: [{ type: 'text', text: result }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr чтобы не ломать stdio протокол.
  console.error('[chatgpt-images] MCP server ready');
}

const shutdown = async () => {
  await browser.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  console.error('[chatgpt-images] fatal:', e);
  process.exit(1);
});
