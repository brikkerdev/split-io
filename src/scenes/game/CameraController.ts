import type Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "@config/game";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { RENDER } from "@config/render";
import { BALANCE } from "@config/balance";
import type { Hero } from "@entities/Hero";

/** Demo camera zoom: > fitZoom so arena edges are clipped. */
const DEMO_ZOOM_FACTOR = 2.2;

export class CameraController {
  private camTarget!: Phaser.GameObjects.Rectangle;

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
    const fitZoom = Math.min(
      GAME_WIDTH / (MAP.radiusPx * 2),
      GAME_HEIGHT / (MAP.radiusPx * 2),
    );
    cam.setZoom(fitZoom * DEMO_ZOOM_FACTOR);
    cam.centerOn(worldW / 2, worldH / 2);
  }

  setupPlay(hero: Hero): void {
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const cam = this.scene.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setZoom(RENDER.camera.zoomMax);
    cam.roundPixels = false;
    this.camTarget.setPosition(hero.pos.x, hero.pos.y);
    cam.startFollow(this.camTarget, false, RENDER.camera.followLerp, RENDER.camera.followLerp);
    cam.centerOn(hero.pos.x, hero.pos.y);
  }

  update(hero: Hero): void {
    const cam = this.scene.cameras.main;
    const cfg = RENDER.camera;

    this.camTarget.x = hero.pos.x + hero.velocity.x * cfg.lookAheadSec;
    this.camTarget.y = hero.pos.y + hero.velocity.y * cfg.lookAheadSec;

    const heroSpeed = Math.sqrt(
      hero.velocity.x * hero.velocity.x + hero.velocity.y * hero.velocity.y,
    );
    const maxSpeedPxSec = BALANCE.heroBaseSpeedCellsPerSec * GRID.cellPx;
    const speedRatio = Math.min(1, heroSpeed / maxSpeedPxSec);
    const targetZoom = cfg.zoomMax + (cfg.zoomMin - cfg.zoomMax) * speedRatio;
    cam.zoom += (targetZoom - cam.zoom) * cfg.zoomLerp;
  }
}
