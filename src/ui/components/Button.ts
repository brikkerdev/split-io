import Phaser from "phaser";
import { UI } from "@config/ui";
import { AUDIO } from "@config/audio";

interface ButtonConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  fontSize?: number;
  onPointerDown: () => void;
}

export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private btnW: number;
  private btnH: number;
  private hovered = false;
  private pressed = false;

  constructor(cfg: ButtonConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    cfg.scene.add.existing(this);

    this.btnW = cfg.width;
    this.btnH = cfg.height;

    this.bg = cfg.scene.add.graphics();
    this.add(this.bg);

    const fs = cfg.fontSize ?? UI.fontSizes.body;
    this.label = cfg.scene.add.text(0, 0, cfg.label, {
      fontSize: `${fs}px`,
      color: "#ffffff",
      fontStyle: "bold",
      wordWrap: { width: cfg.width - 24 },
    }).setOrigin(0.5);
    this.add(this.label);

    this.drawBg();

    const hitArea = new Phaser.Geom.Rectangle(-this.btnW / 2, -this.btnH / 2, this.btnW, this.btnH);
    this.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, true);

    this.on("pointerover", () => {
      this.hovered = true;
      this.drawBg();
      this.tryPlaySfx(AUDIO.sfx.uiHover);
    });
    this.on("pointerout", () => {
      this.hovered = false;
      this.pressed = false;
      this.drawBg();
    });
    this.on("pointerdown", () => {
      this.pressed = true;
      this.drawBg();
      this.tryPlaySfx(AUDIO.sfx.uiClick);
    });
    this.on("pointerup", () => {
      if (this.pressed) {
        this.pressed = false;
        this.drawBg();
        cfg.onPointerDown();
      }
    });
  }

  setText(text: string): void {
    this.label.setText(text);
  }

  private drawBg(): void {
    this.bg.clear();
    const color = this.pressed
      ? UI.colors.btnPress
      : this.hovered
      ? UI.colors.btnHover
      : UI.colors.btnBg;
    this.bg.fillStyle(color, 1);
    this.bg.fillRoundedRect(-this.btnW / 2, -this.btnH / 2, this.btnW, this.btnH, UI.menu.btnBorderRadius);
    this.bg.lineStyle(2, UI.colors.primary, 0.7);
    this.bg.strokeRoundedRect(-this.btnW / 2, -this.btnH / 2, this.btnW, this.btnH, UI.menu.btnBorderRadius);
  }

  private tryPlaySfx(key: string): void {
    try {
      this.scene.sound.play(key, { volume: 0.6 });
    } catch {
      // sound not loaded yet — silent fail
    }
  }
}
