import Phaser from "phaser";
import { locale } from "@systems/Locale";
import { saves } from "@systems/SaveManager";
import { applyStoredUiScale, getDefaultUiScale } from "@ui/dom/uiScale";
import { DEFAULT_SAVE, type SaveV1 } from "@/types/save";
import { ru } from "@/locales/ru";
import { en } from "@/locales/en";
import { tr } from "@/locales/tr";

const TRANSLATIONS = { ru, en, tr };

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    locale.init(TRANSLATIONS);
    // Pick a platform-appropriate default so brand-new players (and anyone who
    // resets progress) start on small UI on mobile and large UI on desktop.
    DEFAULT_SAVE.settings.uiScale = getDefaultUiScale();
    saves
      .load(DEFAULT_SAVE)
      .catch((err) => {
        console.warn("[BootScene] save load failed, using defaults:", err);
      })
      .finally(() => {
        applyStoredUiScale();
        // Yandex passes the chosen language via ?lang= URL param (set by the
        // platform / dev console). That value must take precedence — otherwise
        // a previously saved preference would mask the language the player just
        // picked in the Yandex UI. Saved lang only applies when no URL hint is
        // present and the SDK didn't supply one either.
        const fromUrl = new URLSearchParams(window.location.search).get("lang");
        if (!fromUrl) {
          const savedLang = saves.get<SaveV1>().settings.lang;
          if (savedLang) locale.setLang(savedLang);
        }
        document.title = locale.t("app_title");
        this.scene.start("Preload");
      });
  }
}
