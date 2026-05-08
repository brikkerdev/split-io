import Phaser from "phaser";
import { UI } from "@config/ui";

interface ProgressBarConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: number;
  bgColor?: number;
  radius?: number;
}

export class ProgressBar extends Phaser.GameObjects.Container {
  private fillGfx: Phaser.GameObjects.Graphics;
  private bgGfx: Phaser.GameObjects.Graphics;
  private ratio = 1;
  private barW: number;
  private barH: number;
  private fillColor: number;
  private radius: number;

  constructor(cfg: ProgressBarConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    cfg.scene.add.existing(this);

    this.barW = cfg.width;
    this.barH = cfg.height;
    this.fillColor = cfg.fillColor ?? UI.colors.primary;
    this.radius = cfg.radius ?? 3;

    this.bgGfx = cfg.scene.add.graphics();
    this.bgGfx.fillStyle(cfg.bgColor ?? UI.colors.cooldownBg, 1);
    this.bgGfx.fillRoundedRect(0, 0, this.barW, this.barH, this.radius);
    this.add(this.bgGfx);

    this.fillGfx = cfg.scene.add.graphics();
    this.add(this.fillGfx);

    this.draw();
  }

  setRatio(ratio: number): void {
    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.draw();
  }

  private draw(): void {
    this.fillGfx.clear();
    const w = Math.max(this.radius * 2, this.barW * this.ratio);
    this.fillGfx.fillStyle(this.fillColor, 1);
    this.fillGfx.fillRoundedRect(0, 0, w, this.barH, this.radius);
  }
}
