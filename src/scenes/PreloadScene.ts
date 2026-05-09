import Phaser from "phaser";
import { AUDIO } from "@config/audio";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("Preload");
  }

  preload(): void {
    this.load.on("progress", (v: number) => {
      window.__splash?.setProgress(v);
    });

    this.load.on("complete", () => {
      window.__splash?.setProgress(1);
    });

    const icons = [
      "ic_speed",
      "ic_split",
      "ic_shield",
      "ic_reserve_a",
      "ic_reserve_b",
      "ic_player_marker",
      "triangle",
    ];
    for (const key of icons) {
      this.load.image(key, `images/${key}.png`);
    }

    // Phosphor crown-fill — leader marker.
    this.load.svg("ic_crown", "icons/crown.svg", { width: 64, height: 64 });

    // SFX — ogg primary, m4a Safari fallback. No background music — minimalist .io style.
    const sfx: Array<[string, string]> = [
      [AUDIO.sfx.split, "sfx_split"],
      [AUDIO.sfx.capture, "sfx_capture"],
      [AUDIO.sfx.death, "sfx_death"],
      [AUDIO.sfx.warning, "sfx_warning"],
      [AUDIO.sfx.upgrade, "sfx_upgrade"],
      [AUDIO.sfx.uiClick, "sfx_ui_click"],
      [AUDIO.sfx.uiHover, "sfx_ui_hover"],
      [AUDIO.sfx.countdown, "sfx_countdown"],
      [AUDIO.sfx.matchStart, "sfx_match_start"],
      [AUDIO.sfx.victory, "sfx_victory"],
    ];
    for (const [key, file] of sfx) {
      this.load.audio(key, [
        `audio/sfx/${file}.ogg`,
        `audio/sfx/${file}.m4a`,
      ]);
    }
  }

  create(): void {
    this.scene.start("Game");
  }
}
