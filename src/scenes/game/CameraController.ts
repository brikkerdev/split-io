import type Phaser from "phaser";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { RENDER } from "@config/render";
import { BALANCE } from "@config/balance";
import type { Hero } from "@entities/Hero";
import type { Vec2 } from "@gametypes/geometry";

/** Demo camera zoom: > fitZoom so arena edges are clipped. */
const DEMO_ZOOM_FACTOR = 2.2;

/** Touch/coarse-pointer device → use the pulled-back mobile zoom range. */
function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export class CameraController {
  private camTarget!: Phaser.GameObjects.Rectangle;
  private zoomMax: number = RENDER.camera.zoomMax;
  private zoomMin: number = RENDER.camera.zoomMin;
  private deathOverlay?: Phaser.GameObjects.Rectangle;

  constructor(private readonly scene: Phaser.Scene) {}

  init(): void {
    this.camTarget = this.scene.add
      .rectangle(MAP.centerX, MAP.centerY, 1, 1, 0x000000, 0)
      .setDepth(-1);
  }

  setupDemo(): void {
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const cam = this.scene.cameras.main;
    cam.stopFollow();
    cam.removeBounds();
    this.applyDemoZoom();
    cam.centerOn(worldW / 2, worldH / 2);

    this.scene.scale.off("resize", this.applyDemoZoom, this);
    this.scene.scale.on("resize", this.applyDemoZoom, this);
  }

  private applyDemoZoom = (): void => {
    const cam = this.scene.cameras.main;
    if (!cam) return;
    const fitZoom = Math.min(
      this.scene.scale.width / (MAP.radiusPx * 2),
      this.scene.scale.height / (MAP.radiusPx * 2),
    );
    cam.setZoom(fitZoom * DEMO_ZOOM_FACTOR);
  };

  teardownDemoListeners(): void {
    this.scene.scale.off("resize", this.applyDemoZoom, this);
  }

  setupPlay(hero: Hero): void {
    this.teardownDemoListeners();
    const mobile = isMobileViewport();
    this.zoomMax = mobile ? RENDER.camera.zoomMaxMobile : RENDER.camera.zoomMax;
    this.zoomMin = mobile ? RENDER.camera.zoomMinMobile : RENDER.camera.zoomMin;

    const cam = this.scene.cameras.main;
    cam.removeBounds();
    cam.setZoom(this.zoomMax);
    cam.roundPixels = false;
    this.camTarget.setPosition(hero.pos.x, hero.pos.y);
    cam.startFollow(this.camTarget, false, RENDER.camera.followLerp, RENDER.camera.followLerp);
    cam.centerOn(hero.pos.x, hero.pos.y);
  }

  update(hero: Hero): void {
    const cam = this.scene.cameras.main;
    const cfg = RENDER.camera;

    this.camTarget.x = hero.pos.x;
    this.camTarget.y = hero.pos.y;

    const heroSpeed = Math.sqrt(
      hero.velocity.x * hero.velocity.x + hero.velocity.y * hero.velocity.y,
    );
    const maxSpeedPxSec = BALANCE.heroBaseSpeedCellsPerSec * GRID.cellPx;
    const speedRatio = Math.min(1, heroSpeed / maxSpeedPxSec);
    const targetZoom = this.zoomMax + (this.zoomMin - this.zoomMax) * speedRatio;
    cam.zoom += (targetZoom - cam.zoom) * cfg.zoomLerp;
  }

  /**
   * Post-mortem sequence: zoom out to deathPos and fade in a dark vignette.
   * Returns a Promise that resolves after zoomMs + pauseMs.
   */
  postMortemZoom(deathPos: Vec2): Promise<void> {
    const cfg = RENDER.postMortem;
    const cam = this.scene.cameras.main;

    // Stop following hero so we can pan freely.
    cam.stopFollow();

    const targetZoom = Math.max(cfg.zoomFactor * cam.zoom, 0.4);
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const panX = Math.max(0, Math.min(deathPos.x, worldW));
    const panY = Math.max(0, Math.min(deathPos.y, worldH));

    // Zoom tween via camTarget position + scene camera zoom.
    this.scene.tweens.add({
      targets: cam,
      zoom: targetZoom,
      duration: cfg.zoomMs,
      ease: "Quad.easeInOut",
    });

    this.scene.tweens.add({
      targets: this.camTarget,
      x: panX,
      y: panY,
      duration: cfg.zoomMs,
      ease: "Quad.easeInOut",
      onStart: () => {
        // Re-attach follow so the tween drives camTarget which camera follows.
        cam.startFollow(this.camTarget, false, 1, 1);
      },
    });

    // Full-screen overlay vignette (scroll-factor 0 = fixed to screen).
    if (this.deathOverlay) {
      this.deathOverlay.destroy();
    }
    const sw = this.scene.scale.width;
    const sh = this.scene.scale.height;
    this.deathOverlay = this.scene.add
      .rectangle(sw / 2, sh / 2, sw, sh, 0x000000, 0)
      .setScrollFactor(0)
      .setDepth(500)
      .setAlpha(0);

    this.scene.tweens.add({
      targets: this.deathOverlay,
      alpha: cfg.overlayAlpha,
      duration: cfg.zoomMs,
      ease: "Quad.easeIn",
    });

    return new Promise<void>((resolve) => {
      this.scene.time.delayedCall(cfg.zoomMs + cfg.pauseMs, () => {
        resolve();
      });
    });
  }

  /** Remove the death overlay if it exists (call before restarting). */
  clearDeathOverlay(): void {
    if (this.deathOverlay) {
      this.deathOverlay.destroy();
      this.deathOverlay = undefined;
    }
  }
}
