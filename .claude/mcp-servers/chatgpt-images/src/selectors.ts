/**
 * Все селекторы UI ChatGPT в одном месте.
 * Если что-то отвалится — чинить здесь.
 */
export const SELECTORS = {
  // Основной редактор промпта (ProseMirror).
  promptInput: 'div#prompt-textarea[contenteditable="true"]',
  // Кнопка отправки сообщения.
  sendButton: 'button[data-testid="send-button"]',
  // Кнопка остановки генерации (значит, идёт стрим).
  stopButton: 'button[data-testid="stop-button"]',
  // Контейнер сообщения ассистента.
  assistantMessage: '[data-message-author-role="assistant"]',
  // Изображения в сообщениях ассистента (DALL-E результат).
  assistantImage: '[data-message-author-role="assistant"] img',
  // Признаки капчи / Cloudflare challenge.
  cloudflareChallenge: '#challenge-running, iframe[src*="challenges.cloudflare.com"], #cf-challenge-running',
  // Признаки rate limit в чате (текстовый маркер).
  rateLimitText: 'text=/rate limit|too many requests|try again later/i',
  // Кнопка логина (если сессия слетела).
  loginButton: 'button:has-text("Log in"), a:has-text("Log in")',
};

export const URLS = {
  newChat: 'https://chatgpt.com/?model=gpt-4o',
  base: 'https://chatgpt.com/',
};
