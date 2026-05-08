import Phaser from "phaser";
import { locale } from "@systems/Locale";
import { saves } from "@systems/SaveManager";
import { DEFAULT_SAVE } from "@/types/save";
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
    saves
      .load(DEFAULT_SAVE)
      .catch((err) => {
        console.warn("[BootScene] save load failed, using defaults:", err);
      })
      .finally(() => {
        this.scene.start("Preload");
      });
  }
}
