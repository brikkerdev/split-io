import Phaser from "phaser";
import { AUDIO } from "@config/audio";
import { GAME_HEIGHT, GAME_WIDTH } from "@config/game";
import { PALETTE } from "@config/palette";
import { yandex } from "@sdk/yandex";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("Preload");
  }

  preload(): void {
    this.createProgressBar();

    const icons = [
      "ic_speed",
      "ic_homing",
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
    yandex.gameReady();
    this.scene.start("Game");
  }

  private createProgressBar(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    const barW = 400;
    const barH = 20;

    this.add
      .rectangle(cx, cy, barW + 4, barH + 4, PALETTE.gridLine)
      .setStrokeStyle(1, PALETTE.ui.accent);

    const fill = this.add
      .rectangle(cx - barW / 2, cy, 0, barH, PALETTE.ui.accent)
      .setOrigin(0, 0.5);

    const label = this.add
      .text(cx, cy - 36, "SPLIT.IO", {
        fontSize: "32px",
        color: "#21f0ff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    void label;

    this.load.on("progress", (v: number) => {
      fill.width = barW * v;
    });
  }
}
