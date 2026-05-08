import { locale } from "@systems/Locale";

/**
 * Apply locale.t() to all elements with data-i18n="key" within root.
 * Supports {placeholder} replacements via data-i18n-vars='{"key":"val"}'.
 */
export function applyI18n(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n ?? "";
    let text = locale.t(key);

    const rawVars = el.dataset.i18nVars;
    if (rawVars) {
      const vars = JSON.parse(rawVars) as Record<string, string>;
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(`{${k}}`, v);
      }
    }

    el.textContent = text;
  });
}

/** Shorthand: build a text node translated by key. */
export function t(key: string, replacements?: Record<string, string>): string {
  let text = locale.t(key);
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
