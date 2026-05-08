import Phaser from "phaser";
import { UI } from "@config/ui";
import { AUDIO } from "@config/audio";
import { PALETTE } from "@config/palette";
import { locale } from "@systems/Locale";
import type { UpgradeId, UpgradeDef } from "@config/upgrades";

function tintForUpgrade(id: UpgradeId): number {
  const map = PALETTE.upgradeIcon;
  switch (id) {
    case "speed":         return map.speed;
    case "homingDelay":   return map.homingDelay;
    case "splitCooldown": return map.splitCooldown;
    case "shield":        return map.shield;
    default:              return map.default;
  }
}

interface UpgradeCardConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  def: UpgradeDef;
  onPick: (id: UpgradeId) => void;
}

export class UpgradeCard extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private hovered = false;

  constructor(cfg: UpgradeCardConfig) {
    super(cfg.scene, cfg.x, cfg.y);
    cfg.scene.add.existing(this);

    const w = UI.upgrade.cardW;
    const h = UI.upgrade.cardH;

    this.bg = cfg.scene.add.graphics();
    this.add(this.bg);
    this.drawBg(false);

    // Icon placeholder (uses atlas key when available, else drawn circle)
    const iconSize = UI.upgrade.iconSize;
    const iconBg = cfg.scene.add.graphics();
    iconBg.fillStyle(UI.colors.primary, 0.15);
    iconBg.fillCircle(0, -h / 2 + iconSize / 2 + 28, iconSize / 2 + 8);
    this.add(iconBg);

    // Try to show image, fallback to text icon
    const iconY = -h / 2 + iconSize / 2 + 28;
    if (cfg.scene.textures.exists(cfg.def.iconKey)) {
      const img = cfg.scene.add.image(0, iconY, cfg.def.iconKey)
        .setDisplaySize(iconSize, iconSize)
        .setTint(tintForUpgrade(cfg.def.id));
      this.add(img);
    } else {
      const iconText = cfg.scene.add.text(0, iconY, "✦", {
        fontSize: `${iconSize * 0.6}px`,
        color: "#21f0ff",
      }).setOrigin(0.5);
      this.add(iconText);
    }

    // Title
    const title = cfg.scene.add.text(0, -h / 2 + iconSize + 52, locale.t(cfg.def.labelKey), {
      fontSize: `${UI.fontSizes.body}px`,
      color: "#21f0ff",
      fontStyle: "bold",
      wordWrap: { width: w - 24 },
      align: "center",
    }).setOrigin(0.5, 0);
    this.add(title);

    // Description
    const descKey = `${cfg.def.id}_desc`;
    const desc = cfg.scene.add.text(0, -h / 2 + iconSize + 52 + UI.fontSizes.body + 12, locale.t(`upgrade_${descKey}`, ""), {
      fontSize: `${UI.fontSizes.small}px`,
      color: "#aabbcc",
      wordWrap: { width: w - 24 },
      align: "center",
    }).setOrigin(0.5, 0);
    this.add(desc);

    // Hit area
    const hitArea = new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h);
    this.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains, true);

    this.on("pointerover", () => {
      this.hovered = true;
      this.drawBg(true);
    });
    this.on("pointerout", () => {
      this.hovered = false;
      this.drawBg(false);
    });
    this.on("pointerdown", () => {
      try { cfg.scene.sound.play(AUDIO.sfx.upgrade, { volume: 0.8 }); } catch { /* silent */ }
      cfg.onPick(cfg.def.id);
    });
  }

  private drawBg(hover: boolean): void {
    this.bg.clear();
    const w = UI.upgrade.cardW;
    const h = UI.upgrade.cardH;
    const color = hover ? UI.colors.upgradeCardHover : UI.colors.upgradeCard;
    this.bg.fillStyle(color, 0.95);
    this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    this.bg.lineStyle(2, this.hovered ? UI.colors.primary : UI.colors.panelBorder, hover ? 1 : 0.5);
    this.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
  }
}
