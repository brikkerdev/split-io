/**
 * Ручной тест: вызывает ChatGPTBrowser напрямую без MCP-обёртки.
 * Запуск: npm run test:manual -- "promp text" 1:1 ./out.png
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatGPTBrowser, type AspectRatio } from '../src/browser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE = resolve(__dirname, '..', 'auth', 'storageState.json');

async function main() {
  const [, , promptArg, aspectArg, outArg] = process.argv;
  const prompt = promptArg ?? 'a cute pixel art robot waving, transparent background, game asset';
  const aspect = (aspectArg as AspectRatio) ?? '1:1';
  const out = outArg ?? resolve(__dirname, 'manual-out.png');

  const headless = process.env.CHATGPT_MCP_HEADLESS === '1';
  const browser = new ChatGPTBrowser({ storageStatePath: STORAGE, headless });
  console.log('Starting browser...');
  await browser.start();
  try {
    console.log(`Generating: ${prompt} (${aspect}) -> ${out}`);
    const t0 = Date.now();
    const path = await browser.generate(prompt, aspect, out);
    console.log(`OK in ${Date.now() - t0}ms: ${path}`);
  } finally {
    await browser.stop();
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
