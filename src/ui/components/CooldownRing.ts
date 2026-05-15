import Phaser from "phaser";
import { UI } from "@config/ui";

interface CooldownRingConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  radius?: number;
  fillColor?: number;
}

export class CooldownRing extends Phaser.GameObjects.Container {
  private gfx: Phaser.GameObjects.Graphics;
  private ratio = 1;
  private ready = true;
  private pulseTween: Phaser.Tweens.Tween | null = null;
  private ringRadius: number;
  private fillColor: number;
  private label: Phaser.GameObjects.Text;

  constructor(cfg: CooldownRingConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    cfg.scene.add.existing(this);

    this.ringRadius = cfg.radius ?? UI.hud.cooldownRadius;
    this.fillColor = cfg.fillColor ?? UI.colors.primary;

    this.gfx = cfg.scene.add.graphics();
    this.add(this.gfx);

    this.label = cfg.scene.add.text(0, 0, "", {
      fontSize: `${UI.fontSizes.small}px`,
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.add(this.label);

    this.draw();
  }

  setCooldown(ratio: number, ready: boolean): void {
    this.ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.ready = ready;
    this.draw();

    if (ready && !this.pulseTween) {
      this.startPulse();
    } else if (!ready && this.pulseTween) {
      this.stopPulse();
    }
  }

  private draw(): void {
    this.gfx.clear();
    const r = this.ringRadius;
    const lw = UI.hud.cooldownLineWidth;

    // Background ring
    this.gfx.lineStyle(lw, UI.colors.cooldownBg, UI.hud.cooldownBgAlpha);
    this.gfx.strokeCircle(0, 0, r);

    // Fill arc (ratio of circumference)
    if (this.ratio > 0) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + Math.PI * 2 * this.ratio;
      this.gfx.lineStyle(lw, this.ready ? UI.colors.primary : this.fillColor, 1);
      this.gfx.beginPath();
      this.gfx.arc(0, 0, r, startAngle, endAngle, false);
      this.gfx.strokePath();
    }

    // Center circle
    this.gfx.fillStyle(this.ready ? UI.colors.primary : UI.colors.cooldownBg, this.ready ? 0.3 : 0.6);
    this.gfx.fillCircle(0, 0, r - lw - 2);
  }

  private startPulse(): void {
    this.pulseTween = this.scene.tweens.add({
      targets: this,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: UI.hud.pulsePeriod / 2,
      yoyo: true,
      repeat: -1,
      ease: UI.tweens.easing,
    });
  }

  private stopPulse(): void {
    this.pulseTween?.stop();
    this.pulseTween = null;
    this.setScale(1);
  }

  override destroy(fromScene?: boolean): void {
    this.stopPulse();
    super.destroy(fromScene);
  }
}
