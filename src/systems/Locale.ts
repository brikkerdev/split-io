import { DEFAULT_LANG, type Lang } from "@config/game";
import { yandex } from "@sdk/yandex";

type Dict = Record<string, string>;
type Translations = Record<Lang, Dict>;

class Locale {
  private lang: Lang = DEFAULT_LANG;
  private translations: Translations = { ru: {}, en: {}, tr: {} };

  init(translations: Translations): void {
    this.translations = translations;
    this.lang = yandex.getLang();
  }

  t(key: string, fallback?: string): string {
    return this.translations[this.lang]?.[key] ?? fallback ?? key;
  }

  getLang(): Lang {
    return this.lang;
  }

  setLang(lang: Lang): void {
    this.lang = lang;
  }
}

export const locale = new Locale();
