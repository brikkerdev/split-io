import Phaser from "phaser";
import { UI } from "@config/ui";

interface PanelConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export class Panel extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  readonly panelWidth: number;
  readonly panelHeight: number;

  constructor(cfg: PanelConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    cfg.scene.add.existing(this);

    this.panelWidth = cfg.width;
    this.panelHeight = cfg.height;

    this.bg = cfg.scene.add.graphics();
    const r = cfg.radius ?? 16;
    this.bg.fillStyle(UI.colors.panelBg, UI.alpha.panel);
    this.bg.fillRoundedRect(-cfg.width / 2, -cfg.height / 2, cfg.width, cfg.height, r);
    this.bg.lineStyle(2, UI.colors.panelBorder, UI.alpha.panelBorder);
    this.bg.strokeRoundedRect(-cfg.width / 2, -cfg.height / 2, cfg.width, cfg.height, r);
    this.add(this.bg);
  }
}
