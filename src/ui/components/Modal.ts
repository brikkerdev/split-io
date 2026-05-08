import Phaser from "phaser";
import { UI } from "@config/ui";
import { AUDIO } from "@config/audio";

interface ModalConfig {
  scene: Phaser.Scene;
  width: number;
  height: number;
  title?: string;
  showClose?: boolean;
  onClose?: () => void;
}

export class Modal extends Phaser.GameObjects.Container {
  private overlay: Phaser.GameObjects.Rectangle;
  private panel: Phaser.GameObjects.Graphics;
  private closeBtn?: Phaser.GameObjects.Container;
  readonly contentY: number;
  readonly panelW: number;
  readonly panelH: number;

  constructor(cfg: ModalConfig) {
    const sw = cfg.scene.scale.width;
    const sh = cfg.scene.scale.height;
    super(cfg.scene, sw / 2, sh / 2);
    cfg.scene.add.existing(this);

    this.panelW = cfg.width;
    this.panelH = cfg.height;

    // Overlay blocks input on underlying scenes
    this.overlay = cfg.scene.add.rectangle(0, 0, sw * 2, sh * 2, UI.colors.overlay, UI.alpha.overlay);
    this.overlay.setInteractive();
    this.add(this.overlay);

    // Panel
    this.panel = cfg.scene.add.graphics();
    const r = 16;
    this.panel.fillStyle(UI.colors.panelBg, UI.alpha.panel);
    this.panel.fillRoundedRect(-cfg.width / 2, -cfg.height / 2, cfg.width, cfg.height, r);
    this.panel.lineStyle(2, UI.colors.panelBorder, UI.alpha.panelBorder);
    this.panel.strokeRoundedRect(-cfg.width / 2, -cfg.height / 2, cfg.width, cfg.height, r);
    this.add(this.panel);

    let titleBottom = -cfg.height / 2 + 24;

    if (cfg.title) {
      const titleText = cfg.scene.add.text(0, -cfg.height / 2 + 40, cfg.title, {
        fontSize: `${UI.fontSizes.h3}px`,
        color: "#21f0ff",
        fontStyle: "bold",
      }).setOrigin(0.5, 0);
      this.add(titleText);
      titleBottom = -cfg.height / 2 + 40 + UI.fontSizes.h3 + 16;
    }

    this.contentY = titleBottom;

    if (cfg.showClose !== false) {
      this.closeBtn = this.buildCloseBtn(cfg.scene, cfg.width, cfg.height, cfg.onClose);
      this.add(this.closeBtn);
    }

    // Appear animation
    this.setAlpha(0);
    this.setScale(0.9);
    cfg.scene.tweens.add({
      targets: this,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: UI.tweens.medium,
      ease: UI.tweens.easing,
    });
  }

  dismiss(onDone?: () => void): void {
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleX: 0.9,
      scaleY: 0.9,
      duration: UI.tweens.fast,
      ease: UI.tweens.easing,
      onComplete: () => {
        this.destroy();
        onDone?.();
      },
    });
  }

  private buildCloseBtn(
    scene: Phaser.Scene,
    w: number,
    h: number,
    onClose?: () => void,
  ): Phaser.GameObjects.Container {
    const container = scene.add.container(w / 2 - UI.modal.closeBtnPad - UI.modal.closeBtnSize / 2, -h / 2 + UI.modal.closeBtnPad + UI.modal.closeBtnSize / 2);

    const circle = scene.add.graphics();
    circle.fillStyle(UI.colors.danger, 0.8);
    circle.fillCircle(0, 0, UI.modal.closeBtnSize / 2);
    container.add(circle);

    const x = scene.add.text(0, 0, "✕", {
      fontSize: `${UI.fontSizes.body}px`,
      color: "#ffffff",
    }).setOrigin(0.5);
    container.add(x);

    container.setInteractive(
      new Phaser.Geom.Circle(0, 0, UI.modal.closeBtnSize / 2),
      Phaser.Geom.Circle.Contains,
      true,
    );
    container.on("pointerdown", () => {
      try { scene.sound.play(AUDIO.sfx.uiClick, { volume: 0.6 }); } catch { /* silent */ }
      onClose?.();
    });

    return container;
  }
}
