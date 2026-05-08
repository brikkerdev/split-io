import Phaser from "phaser";
import { AUDIO } from "@config/audio";
import { ADS } from "@config/ads";
import { BALANCE } from "@config/balance";
import { BOTS } from "@config/bots";
import { GRID } from "@config/grid";
import { GAME_HEIGHT, GAME_WIDTH } from "@config/game";
import { MAP } from "@config/map";
import { PALETTE } from "@config/palette";
import { RENDER } from "@config/render";
import { GameEvents } from "@events/GameEvents";
import { Hero } from "@entities/Hero";
import { GridSystem } from "@systems/GridSystem";
import { TrailSystem } from "@systems/TrailSystem";
import { TerritorySystem } from "@systems/TerritorySystem";
import { GhostSystem } from "@systems/GhostSystem";
import { BotAI } from "@systems/BotAI";
import { InputSystem } from "@systems/InputSystem";
import { ScoreSystem } from "@systems/ScoreSystem";
import { ProgressionSystem } from "@systems/ProgressionSystem";
import { JuiceSystem } from "@systems/JuiceSystem";
import { AchievementSystem } from "@systems/AchievementSystem";
import { saves } from "@systems/SaveManager";
import { AdSystem } from "@systems/AdSystem";
import { DomUI } from "@ui/dom/DomUI";
import { SKINS } from "@config/skins";
import { yandex } from "@sdk/yandex";
import type { SaveV1 } from "@/types/save";
import type { RoundBreakdown } from "@gametypes/round";
import type {
  LeaderboardEntry,
  LeaderboardUpdatePayload,
  TerritoryCapturedPayload,
} from "@gametypes/events";
import type { Vec2 } from "@gametypes/geometry";
import { t } from "@ui/dom/i18n";

const DEPTH_BG = 0;
const DEPTH_TERRITORY = 10;
const DEPTH_TRAIL = 20;
const DEPTH_UNIT = 30;

const HERO_RADIUS_PX = 10;
const BOT_RADIUS_PX = 9;

// Split-triangle visuals — same color as hero, triangle = "the ghost".
const SPLIT_TRI_HALF = 6;        // half of base displaySize
const SPLIT_TRI_GAP_MIN = 2;     // spacing from hero edge while recharging (start)
const SPLIT_TRI_GAP_MAX = 11;    // spacing when fully ready

const GLOW_BOT_COUNT = 5;

const DEMO_BOT_COUNT = 12;
const DEMO_FAIRNESS_RESET_SEC = 60;
const DEMO_FAIRNESS_PCT_LIMIT = 30;
/** Demo camera zoom: > fitZoom so arena edges are clipped. */
const DEMO_ZOOM_FACTOR = 1.45;

type GamePhase = "demo" | "playing" | "gameover";

function shadeColor(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const adjust = (c: number): number => {
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
}

export class GameScene extends Phaser.Scene {
  private grid!: GridSystem;
  private trailSys!: TrailSystem;
  private territorySys!: TerritorySystem;
  private ghostSys!: GhostSystem;
  private botAI!: BotAI;
  private inputSys!: InputSystem;
  private scoreSys!: ScoreSystem;
  private progressionSys!: ProgressionSystem;
  private juiceSys!: JuiceSystem;
  private achievementSys!: AchievementSystem;

  private hero!: Hero;

  private bgGfx!: Phaser.GameObjects.Graphics;
  private territoryGfx!: Phaser.GameObjects.Graphics;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private unitGfx!: Phaser.GameObjects.Graphics;

  // Triangle sprites — hero-colored. Loaded "split arrow" on the hero
  // and the flying ghost. Outline twins (darker, larger, behind) are masked
  // to hero territory so a darker rim peeks out only over own land.
  private splitTriSprite?: Phaser.GameObjects.Image;
  private ghostSprite?: Phaser.GameObjects.Image;
  private splitTriOutline?: Phaser.GameObjects.Image;
  private ghostOutline?: Phaser.GameObjects.Image;

  // Hero highlight: darker outline ring drawn over hero, masked by hero
  // territory so it only shows where the hero overlaps own cells.
  private heroHighlightGfx?: Phaser.GameObjects.Graphics;
  private heroOwnMaskGfx?: Phaser.GameObjects.Graphics;

  private camTarget!: Phaser.GameObjects.Rectangle;

  private territoryDirty = true;

  private phase: GamePhase = "demo";
  private isFirstRound = false;
  private firstRoundPassiveTimer = 0;
  private roundStartMs = 0;
  private roundEndEmitted = false;
  private continueUsed = false;
  private demoFairnessTimer = 0;

  private adSys = new AdSystem();
  private domUI = DomUI.get();

  private heroFill: number = PALETTE.hero.fill;
  private heroTerritory: number = PALETTE.hero.territory;
  private heroTrail: number = PALETTE.hero.trail;

  private isPaused = false;
  private pauseStartMs = 0;

  constructor() {
    super("Game");
  }

  create(): void {
    this.territoryDirty = true;
    this.firstRoundPassiveTimer = 0;
    this.roundEndEmitted = false;
    this.isPaused = false;
    this.pauseStartMs = 0;
    this.continueUsed = false;
    this.demoFairnessTimer = 0;
    this.phase = "demo";

    const save = saves.get<SaveV1>();
    this.isFirstRound = save.roundsPlayed === 0;
    this.game.sound.volume = save.settings.sfxVolume ?? 1.0;

    const fallbackSkin = SKINS[0]!;
    let skinDef = SKINS.find((s) => s.id === save.selectedSkin);
    if (!skinDef) {
      skinDef = fallbackSkin;
      saves.patch({
        selectedSkin: skinDef.id,
        unlockedSkins: save.unlockedSkins?.includes(skinDef.id)
          ? save.unlockedSkins
          : [...(save.unlockedSkins ?? []), skinDef.id],
      });
    }
    this.heroFill = skinDef.fill;
    this.heroTerritory = shadeColor(skinDef.fill, -0.3);
    this.heroTrail = shadeColor(skinDef.fill, 0.2);

    this.adSys.resetRoundContinue();

    this.initSystems(save);
    this.createGraphicsLayers();
    this.bindEvents();
    this.spawnDemoBots();
    this.setupDemoCamera();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    this.game.events.on(GameEvents.RoundContinue, this.applyContinue, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(GameEvents.RoundContinue, this.applyContinue, this);
    }, this);

    try {
      this.sound.stopAll();
    } catch { /* silent */ }

    this.domUI.mountMenu(this.game, () => this.enterPlayMode());

    this.time.delayedCall(0, () => this.emitLeaderboard());
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;

    if (this.phase === "playing" && !this.isPaused) {
      if (this.isFirstRound && this.firstRoundPassiveTimer < BALANCE.botFirstRoundPassiveSec) {
        this.firstRoundPassiveTimer += dt;
      }
      this.inputSys.update(delta, this.hero.pos.x, this.hero.pos.y);
      this.moveHero(dt);
      this.updateCamera(dt);
      this.ghostSys.update(dt, this.time.now, this.hero);
      this.progressionSys.onTerritoryPct(
        this.territorySys.getOwnerPercent(this.hero.id),
      );
    }

    if (this.phase !== "gameover" || this.phase === "gameover") {
      // Bots tick in all phases except when paused (pause only matters in playing).
      const botsActive = this.phase !== "playing" || !this.isPaused;
      if (botsActive) this.botAI.update(dt);
    }

    if (this.phase === "demo") {
      this.tickDemoFairness(dt);
    }

    this.renderFrame();
  }

  // ---------------------------------------------------------------------------
  // Phase transitions
  // ---------------------------------------------------------------------------

  enterPlayMode(): void {
    if (this.phase === "playing") return;

    this.domUI.dismountMenu();

    this.spawnHero();
    this.setupPlayCamera();

    this.phase = "playing";
    this.roundStartMs = this.time.now;
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.adSys.resetRoundContinue();
    this.achievementSys.resetRound();

    yandex.gameplayStart();
    try {
      this.sound.stopAll();
      if (this.cache.audio.exists(AUDIO.sfx.matchStart)) {
        this.sound.play(AUDIO.sfx.matchStart, { volume: 0.7 });
      }
    } catch { /* silent */ }

    this.scene.launch("UI", { heroId: this.hero.id });
    this.time.delayedCall(0, () => this.emitLeaderboard());
  }

  private endRound(): void {
    if (this.roundEndEmitted) return;
    this.roundEndEmitted = true;
    this.phase = "gameover";

    yandex.gameplayStop();

    const elapsedSec = (this.time.now - this.roundStartMs) / 1000;
    const territoryPct = this.territorySys.getOwnerPercent(this.hero.id);
    const breakdown: RoundBreakdown = this.scoreSys.finalize(elapsedSec, territoryPct);

    this.events.emit(GameEvents.RoundEnd, breakdown);

    const save = saves.get<SaveV1>();
    const newBest = breakdown.total > save.bestScore;
    saves.patch({
      roundsPlayed: save.roundsPlayed + 1,
      bestScore: newBest ? breakdown.total : save.bestScore,
    });

    this.time.delayedCall(400, () => {
      if (this.phase !== "gameover") return;
      this.scene.stop("UI");
      this.domUI.mountGameOver(
        this.game,
        breakdown,
        true,
        () => this.handleContinueClick(),
        () => this.handleRestartClick(),
        () => this.handleMenuClick(),
      );
    });
  }

  private async handleContinueClick(): Promise<void> {
    if (this.continueUsed) return;
    const granted = await this.adSys.showRewarded("continue");
    if (!granted) return;
    this.continueUsed = true;
    this.domUI.dismountGameOver();
    this.game.events.emit(GameEvents.RoundContinue);
  }

  private async handleRestartClick(): Promise<void> {
    await this.adSys.showInterstitial();
    this.restartRound();
  }

  private handleMenuClick(): void {
    try { this.sound.stopAll(); } catch { /* silent */ }
    this.exitToDemo();
  }

  restartRound(): void {
    this.domUI.dismountGameOver();
    this.releaseHeroState();

    this.spawnHero();
    this.setupPlayCamera();

    this.phase = "playing";
    this.roundStartMs = this.time.now;
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.adSys.resetRoundContinue();
    this.achievementSys.resetRound();

    yandex.gameplayStart();
    try {
      this.sound.stopAll();
      if (this.cache.audio.exists(AUDIO.sfx.matchStart)) {
        this.sound.play(AUDIO.sfx.matchStart, { volume: 0.7 });
      }
    } catch { /* silent */ }

    this.scene.launch("UI", { heroId: this.hero.id });
  }

  exitToDemo(): void {
    this.domUI.dismountGameOver();
    this.releaseHeroState();
    this.setupDemoCamera();

    this.phase = "demo";
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.demoFairnessTimer = 0;

    this.domUI.mountMenu(this.game, () => this.enterPlayMode());
  }

  /** Wipe hero-owned grid + trail + visual + alive flag. Bots untouched. */
  private releaseHeroState(): void {
    this.territorySys.releaseOwner(this.hero.id);
    this.trailSys.clearTrail(this.hero.id);
    this.hero.alive = false;
    this.hero.posHistory = [];
    this.hero.velocity = { x: 0, y: 0 };
    this.ghostSys.destroy();
    this.ghostSys = new GhostSystem(this, this.hero, this.trailSys);
    if (this.isFirstRound) {
      this.ghostSys.setCooldownSec(BALANCE.splitCooldownFirstRoundSec);
    }
    this.trailSys.setPeerGroup(this.hero.id, [this.hero.id]);
    this.territoryDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  private initSystems(save: SaveV1): void {
    this.grid = new GridSystem();
    this.trailSys = new TrailSystem(this, this.grid);
    this.territorySys = new TerritorySystem(this, this.grid);
    this.scoreSys = new ScoreSystem(this);
    this.progressionSys = new ProgressionSystem(this);
    this.juiceSys = new JuiceSystem(this);

    this.hero = new Hero();
    this.hero.speedCellsPerSec = BALANCE.heroBaseSpeedCellsPerSec;
    this.hero.alive = false;
    this.hero.pos = { x: MAP.centerX, y: MAP.centerY };
    this.juiceSys.setHeroId(this.hero.id);
    this.scoreSys.setHeroId(this.hero.id);

    this.ghostSys = new GhostSystem(this, this.hero, this.trailSys);

    if (this.isFirstRound) {
      this.ghostSys.setCooldownSec(BALANCE.splitCooldownFirstRoundSec);
    }

    this.trailSys.setPeerGroup(this.hero.id, [this.hero.id]);

    this.botAI = new BotAI(this, this.grid, this.trailSys, this.hero, this.territorySys);

    const scheme = save.settings.controlScheme;
    this.inputSys = new InputSystem(this, scheme);
    this.inputSys.init();

    this.achievementSys = new AchievementSystem(this, this.hero.id);
    this.achievementSys.resetRound();
  }

  private spawnHero(): void {
    const safe = this.pickRandomSpawnCell();
    const r = GRID.startTerritoryRadiusCells;

    const worldPos = this.grid.cellToWorld(safe);
    this.hero.pos = { x: worldPos.x, y: worldPos.y };
    this.hero.heading = 0;
    this.hero.alive = true;
    this.hero.posHistory = [];
    this.hero.velocity = { x: 0, y: 0 };

    const packed: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ncx = safe.cx + dx;
        const ncy = safe.cy + dy;
        if (!this.grid.inBounds(ncx, ncy)) continue;
        if (this.grid.ownerOf(ncx, ncy) !== 0) continue;
        this.grid.setOwner(ncx, ncy, this.hero.id);
        packed.push(ncy * this.grid.cols + ncx);
      }
    }
    this.territorySys.claimCells(this.hero.id, packed);

    this.trailSys.setPeerGroup(this.hero.id, [this.hero.id]);
    this.territoryDirty = true;
  }

  /** Pick a random unowned cell inside the play circle, away from claimed cells. */
  private pickRandomSpawnCell(): { cx: number; cy: number } {
    const r = GRID.startTerritoryRadiusCells;
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    const cellPx = this.grid.cellPx;
    const innerR = MAP.radiusPx - (r + 2) * cellPx;

    for (let attempt = 0; attempt < 64; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * innerR;
      const wx = MAP.centerX + Math.cos(ang) * rad;
      const wy = MAP.centerY + Math.sin(ang) * rad;
      const { cx, cy } = this.grid.worldToCell({ x: wx, y: wy });
      if (this.grid.ownerOf(cx, cy) !== 0) continue;
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) {
        for (let dx = -r; dx <= r && ok; dx++) {
          const ncx = cx + dx;
          const ncy = cy + dy;
          if (!this.grid.inBounds(ncx, ncy)) continue;
          const o = this.grid.ownerOf(ncx, ncy);
          if (o !== 0 && o !== this.hero.id) ok = false;
        }
      }
      if (ok) return { cx, cy };
    }
    // Fallback: any unowned cell.
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (this.grid.ownerOf(cx, cy) === 0) return { cx, cy };
      }
    }
    return { cx: Math.floor(cols / 2), cy: Math.floor(rows / 2) };
  }

  private spawnDemoBots(): void {
    this.botAI.spawn({
      count: DEMO_BOT_COUNT,
      passive: false,
      profileWeights: { aggressor: 0.35, tourist: 0.4, hoarder: 0.25 },
    });
  }

  private tickDemoFairness(dt: number): void {
    this.demoFairnessTimer += dt;
    if (this.demoFairnessTimer < DEMO_FAIRNESS_RESET_SEC) return;
    this.demoFairnessTimer = 0;
    for (const bot of this.botAI.getAll()) {
      const pct = this.territorySys.getOwnerPercent(bot.id);
      if (pct > DEMO_FAIRNESS_PCT_LIMIT) {
        this.territorySys.shrinkOwner(bot.id, 0.4);
      }
    }
    this.territoryDirty = true;
  }

  private createGraphicsLayers(): void {
    this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
    this.territoryGfx = this.add.graphics().setDepth(DEPTH_TERRITORY);
    this.trailGfx = this.add.graphics().setDepth(DEPTH_TRAIL);
    this.unitGfx = this.add.graphics().setDepth(DEPTH_UNIT);

    // Hero highlight + mask (mask gfx lives offscreen as geometry source).
    this.heroOwnMaskGfx = this.make.graphics({}, false);
    this.heroHighlightGfx = this.add.graphics().setDepth(DEPTH_UNIT + 0.5);
    this.heroHighlightGfx.setMask(this.heroOwnMaskGfx.createGeometryMask());

    if (this.textures.exists("triangle")) {
      const triPx = SPLIT_TRI_HALF * 2.4;
      const outlineScale = 1.35;
      const outlineTint = shadeColor(this.heroFill, -0.45);

      this.splitTriOutline = this.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 0.6)
        .setDisplaySize(triPx * outlineScale, triPx * outlineScale)
        .setTint(outlineTint)
        .setVisible(false)
        .setMask(this.heroOwnMaskGfx.createGeometryMask());

      this.splitTriSprite = this.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 1)
        .setDisplaySize(triPx, triPx)
        .setTint(this.heroFill)
        .setVisible(false);

      this.ghostOutline = this.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 0.6)
        .setDisplaySize(triPx * 1.05 * outlineScale, triPx * 1.05 * outlineScale)
        .setTint(outlineTint)
        .setVisible(false)
        .setMask(this.heroOwnMaskGfx.createGeometryMask());

      this.ghostSprite = this.add
        .image(0, 0, "triangle")
        .setDepth(DEPTH_UNIT + 1)
        .setDisplaySize(triPx * 1.05, triPx * 1.05)
        .setTint(this.heroFill)
        .setVisible(false);
    }

    this.camTarget = this.add
      .rectangle(MAP.centerX, MAP.centerY, 1, 1, 0x000000, 0)
      .setDepth(-1);

    this.drawStaticBg();
  }

  private setupDemoCamera(): void {
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const cam = this.cameras.main;
    cam.stopFollow();
    // No bounds in demo: bounds clamp the camera and break centering when
    // viewport-in-world > world. Demo camera sits free, centered on arena.
    cam.removeBounds();
    const fitZoom = Math.min(
      GAME_WIDTH / (MAP.radiusPx * 2),
      GAME_HEIGHT / (MAP.radiusPx * 2),
    );
    cam.setZoom(fitZoom * DEMO_ZOOM_FACTOR);
    cam.centerOn(worldW / 2, worldH / 2);
  }

  private setupPlayCamera(): void {
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.setZoom(RENDER.camera.zoomMax);
    cam.roundPixels = false;
    this.camTarget.setPosition(this.hero.pos.x, this.hero.pos.y);
    cam.startFollow(this.camTarget, false, RENDER.camera.followLerp, RENDER.camera.followLerp);
    cam.centerOn(this.hero.pos.x, this.hero.pos.y);
  }

  private bindEvents(): void {
    this.events.on(GameEvents.TrailCut, (payload: { victim: number; killer: number }) => {
      if (payload.victim === this.hero.id) {
        this.handlePlayerDeath("trail_cut");
      }
    });

    this.events.on(
      GameEvents.GhostSpawned,
      (_payload: { pos: { x: number; y: number }; heading: number }) => {
        const ghost = this.ghostSys.getActive();
        if (ghost) {
          this.trailSys.setPeerGroup(this.hero.id, [this.hero.id, ghost.id]);
        }
      },
    );

    this.events.on(GameEvents.GhostDestroyed, () => {
      this.trailSys.setPeerGroup(this.hero.id, [this.hero.id]);
    });

    this.events.on(GameEvents.TerritoryUpdate, () => {
      this.territoryDirty = true;
      this.emitLeaderboard();
    });
    this.events.on(GameEvents.TerritoryCaptured, (_payload: TerritoryCapturedPayload) => {
      this.territoryDirty = true;
    });

    this.events.on(GameEvents.PlayerDied, () => this.emitLeaderboard());

    this.game.events.on("pause:toggle", this.handlePauseToggle, this);
    this.game.events.on("pause:menu", this.handlePauseMenu, this);
  }

  private emitLeaderboard(): void {
    const heroPct = this.territorySys.getOwnerPercent(this.hero.id);
    const entries: LeaderboardEntry[] = [];
    if (this.phase !== "demo" || this.hero.alive) {
      entries.push({
        id: this.hero.id,
        name: t("hud_lb_you"),
        color: this.heroFill,
        percent: heroPct,
        isHero: true,
        alive: this.hero.alive,
      });
    }

    for (const bot of this.botAI.getAll()) {
      entries.push({
        id: bot.id,
        name: bot.name,
        color: bot.color,
        percent: this.territorySys.getOwnerPercent(bot.id),
        isHero: false,
        alive: bot.alive,
      });
    }

    entries.sort((a, b) => b.percent - a.percent);

    const heroIdx = entries.findIndex((e) => e.isHero);
    const heroRank = heroIdx === -1 ? -1 : heroIdx + 1;
    const payload: LeaderboardUpdatePayload = {
      entries,
      heroRank,
      totalPlayers: entries.length,
    };
    this.events.emit(GameEvents.LeaderboardUpdate, payload);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  private moveHero(dt: number): void {
    if (!this.hero.alive) return;

    const heading = this.inputSys.getDesiredHeading();
    this.hero.heading = Math.atan2(heading.y, heading.x);

    const cellPx = this.grid.cellPx;
    const dx = heading.x * this.hero.speedCellsPerSec * cellPx * dt;
    const dy = heading.y * this.hero.speedCellsPerSec * cellPx * dt;

    if (dt > 0) {
      this.hero.velocity.x = dx / dt;
      this.hero.velocity.y = dy / dt;
    }

    let newX = this.hero.pos.x + dx;
    let newY = this.hero.pos.y + dy;

    const ddx = newX - MAP.centerX;
    const ddy = newY - MAP.centerY;
    const distSq = ddx * ddx + ddy * ddy;
    if (distSq > MAP.radiusPx * MAP.radiusPx) {
      const dist = Math.sqrt(distSq);
      const k = MAP.radiusPx / dist;
      newX = MAP.centerX + ddx * k;
      newY = MAP.centerY + ddy * k;
    }

    this.hero.pos.x = newX;
    this.hero.pos.y = newY;

    const { cx, cy } = this.grid.worldToCell(this.hero.pos);
    const cellOwner = this.grid.ownerOf(cx, cy);

    if (cellOwner !== this.hero.id) {
      const heroTrail = this.trailSys.get(this.hero.id);
      if (heroTrail?.active && heroTrail.hasCell(cx, cy)) {
        const cells = heroTrail.getCells();
        const lastPacked = cells[cells.length - 1];
        const curPacked = cy * this.grid.cols + cx;
        if (lastPacked !== curPacked) {
          this.handlePlayerDeath("self_trail");
          return;
        }
      }
      this.trailSys.addCellToTrail(this.hero.id, cx, cy);
      const collision = this.trailSys.checkTrailCollision(this.hero.id, cx, cy);

      this.appendHeroPosHistory(newX, newY);

      if (collision === "closed") {
        this.trailSys.clearTrail(this.hero.id);
        this.hero.posHistory = [];
        this.ghostSys.onLoopClosed();
      }
    } else {
      const trail = this.trailSys.get(this.hero.id);
      if (trail && trail.active && trail.length > 0) {
        this.trailSys.checkTrailCollision(this.hero.id, cx, cy);
        this.trailSys.clearTrail(this.hero.id);
        this.hero.posHistory = [];
        this.ghostSys.onLoopClosed();
      }
    }

    const ghost = this.ghostSys.getActive();
    if (ghost && ghost.alive) {
      const gCell = this.grid.worldToCell(ghost.pos);
      if (this.grid.ownerOf(gCell.cx, gCell.cy) === this.hero.id) {
        this.ghostSys.markInHome(dt);
      }
    }
  }

  private updateCamera(_dt: number): void {
    const cam = this.cameras.main;
    const cfg = RENDER.camera;

    this.camTarget.x = this.hero.pos.x + this.hero.velocity.x * cfg.lookAheadSec;
    this.camTarget.y = this.hero.pos.y + this.hero.velocity.y * cfg.lookAheadSec;

    const heroSpeed = Math.sqrt(
      this.hero.velocity.x * this.hero.velocity.x +
      this.hero.velocity.y * this.hero.velocity.y,
    );
    const maxSpeedPxSec = BALANCE.heroBaseSpeedCellsPerSec * GRID.cellPx;
    const speedRatio = Math.min(1, heroSpeed / maxSpeedPxSec);
    const targetZoom = cfg.zoomMax + (cfg.zoomMin - cfg.zoomMax) * speedRatio;
    cam.zoom += (targetZoom - cam.zoom) * cfg.zoomLerp;
  }

  private appendHeroPosHistory(x: number, y: number): void {
    const hist = this.hero.posHistory;
    const last = hist[hist.length - 1];
    if (last !== undefined) {
      const dx = x - last.x;
      const dy = y - last.y;
      const threshold = RENDER.trail.sampleDistPx;
      if (dx * dx + dy * dy < threshold * threshold) return;
    }
    hist.push({ x, y });
    if (hist.length > RENDER.trail.maxHistoryLen) {
      hist.shift();
    }
  }

  private handlePlayerDeath(cause: string): void {
    if (this.phase !== "playing") return;
    this.hero.alive = false;
    this.events.emit(GameEvents.PlayerDied, { cause });
    this.endRound();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private drawStaticBg(): void {
    const gfx = this.bgGfx;
    const worldW = GRID.cols * GRID.cellPx;
    const worldH = GRID.rows * GRID.cellPx;
    const cx = MAP.centerX;
    const cy = MAP.centerY;
    const r = MAP.radiusPx;

    const voidColor = shadeColor(PALETTE.bg, -0.18);
    gfx.fillStyle(voidColor, 1);
    gfx.fillRect(0, 0, worldW, worldH);

    const bw = MAP.borderWidthPx;
    gfx.fillStyle(shadeColor(PALETTE.bg, -0.32), 1);
    gfx.fillCircle(cx, cy, r + bw);

    gfx.fillStyle(shadeColor(PALETTE.bg, -0.12), 1);
    gfx.fillCircle(cx, cy, r + bw * 0.55);

    gfx.fillStyle(shadeColor(PALETTE.bg, 0.08), 1);
    gfx.fillCircle(cx, cy, r + 2);

    gfx.fillStyle(PALETTE.bg, 1);
    gfx.fillCircle(cx, cy, r);

    gfx.lineStyle(1, PALETTE.gridLine, GRID.bgLineAlpha);
    const step = GRID.cellPx * GRID.bgLineEvery;
    for (let x = 0; x <= worldW; x += step) {
      const dy = Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
      if (dy > 0) gfx.lineBetween(x, cy - dy, x, cy + dy);
    }
    for (let y = 0; y <= worldH; y += step) {
      const dx = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
      if (dx > 0) gfx.lineBetween(cx - dx, y, cx + dx, y);
    }

    gfx.lineStyle(2, shadeColor(PALETTE.bg, -0.45), 0.75);
    gfx.strokeCircle(cx, cy, r);
  }

  private renderFrame(): void {
    if (this.territoryDirty) {
      this.renderTerritory();
      this.territoryDirty = false;
    }
    this.renderTrails();
    this.renderUnits();
  }

  private renderTerritory(): void {
    const gfx = this.territoryGfx;
    gfx.clear();

    const cellPx = this.grid.cellPx;
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    const shadow = RENDER.territory.shadowOffsetPx;
    const bevel = RENDER.territory.bevelPx;

    const bots = this.botAI.getAll();
    const byOwner = new Map<number, { color: number; cells: number[] }>();

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const owner = this.grid.ownerOf(cx, cy);
        if (owner === 0) continue;
        let entry = byOwner.get(owner);
        if (!entry) {
          let color: number;
          if (owner === this.hero.id) {
            color = this.heroTerritory;
          } else {
            const bot = bots.find((b) => b.id === owner);
            color = bot?.color ?? PALETTE.gridLine;
          }
          entry = { color, cells: [] };
          byOwner.set(owner, entry);
        }
        entry.cells.push(cy * cols + cx);
      }
    }

    gfx.fillStyle(0x000000, RENDER.territory.shadowAlpha);
    for (const [ownerId, { cells }] of byOwner) {
      for (const p of cells) {
        const cx = p % cols;
        const cy = Math.floor(p / cols);
        const isBoundary =
          this.grid.ownerOf(cx - 1, cy) !== ownerId ||
          this.grid.ownerOf(cx + 1, cy) !== ownerId ||
          this.grid.ownerOf(cx, cy - 1) !== ownerId ||
          this.grid.ownerOf(cx, cy + 1) !== ownerId;
        if (!isBoundary) continue;
        gfx.fillRect(
          cx * cellPx + shadow,
          cy * cellPx + shadow,
          cellPx,
          cellPx,
        );
      }
    }

    for (const { color, cells } of byOwner.values()) {
      gfx.fillStyle(color, RENDER.territory.fillAlpha);
      for (const p of cells) {
        const cx = p % cols;
        const cy = Math.floor(p / cols);
        gfx.fillRect(cx * cellPx, cy * cellPx, cellPx, cellPx);
      }
    }

    for (const [ownerId, { color, cells }] of byOwner) {
      const hi = shadeColor(color, RENDER.territory.bevelHiAmount);
      const lo = shadeColor(color, RENDER.territory.bevelLoAmount);
      for (const p of cells) {
        const cx = p % cols;
        const cy = Math.floor(p / cols);
        const x = cx * cellPx;
        const y = cy * cellPx;
        if (this.grid.ownerOf(cx, cy - 1) !== ownerId) {
          gfx.fillStyle(hi, RENDER.territory.bevelAlpha);
          gfx.fillRect(x, y, cellPx, bevel);
        }
        if (this.grid.ownerOf(cx - 1, cy) !== ownerId) {
          gfx.fillStyle(hi, RENDER.territory.bevelAlpha);
          gfx.fillRect(x, y, bevel, cellPx);
        }
        if (this.grid.ownerOf(cx, cy + 1) !== ownerId) {
          gfx.fillStyle(lo, RENDER.territory.bevelAlpha);
          gfx.fillRect(x, y + cellPx - bevel, cellPx, bevel);
        }
        if (this.grid.ownerOf(cx + 1, cy) !== ownerId) {
          gfx.fillStyle(lo, RENDER.territory.bevelAlpha);
          gfx.fillRect(x + cellPx - bevel, y, bevel, cellPx);
        }
      }
    }

    for (const [ownerId, { color, cells }] of byOwner) {
      const contourColor = shadeColor(color, 0.3);
      gfx.lineStyle(RENDER.contour.lineWidth, contourColor, RENDER.contour.alpha);
      for (const p of cells) {
        const cx = p % cols;
        const cy = Math.floor(p / cols);
        const x = cx * cellPx;
        const y = cy * cellPx;
        if (this.grid.ownerOf(cx, cy - 1) !== ownerId) {
          gfx.lineBetween(x, y, x + cellPx, y);
        }
        if (this.grid.ownerOf(cx, cy + 1) !== ownerId) {
          gfx.lineBetween(x, y + cellPx, x + cellPx, y + cellPx);
        }
        if (this.grid.ownerOf(cx - 1, cy) !== ownerId) {
          gfx.lineBetween(x, y, x, y + cellPx);
        }
        if (this.grid.ownerOf(cx + 1, cy) !== ownerId) {
          gfx.lineBetween(x + cellPx, y, x + cellPx, y + cellPx);
        }
      }
    }

    // Rebuild hero-territory geometry mask: simple per-cell fill of hero cells.
    const maskGfx = this.heroOwnMaskGfx;
    if (maskGfx) {
      maskGfx.clear();
      const heroEntry = byOwner.get(this.hero.id);
      if (heroEntry) {
        maskGfx.fillStyle(0xffffff, 1);
        for (const p of heroEntry.cells) {
          const cx = p % cols;
          const cy = Math.floor(p / cols);
          maskGfx.fillRect(cx * cellPx, cy * cellPx, cellPx, cellPx);
        }
      }
    }
  }

  private renderTrails(): void {
    const gfx = this.trailGfx;
    gfx.clear();

    const heroTrail = this.trailSys.get(this.hero.id);
    if (heroTrail && heroTrail.active && this.hero.posHistory.length > 1) {
      this.drawSmoothTrail(
        gfx,
        this.hero.posHistory,
        RENDER.trail.heroLineWidth,
        this.heroTrail,
        RENDER.trail.heroAlpha,
      );
    }

    const ghost = this.ghostSys.getActive();
    if (ghost && ghost.alive) {
      const ghostTrail = this.trailSys.get(ghost.id);
      if (ghostTrail && ghostTrail.active && ghost.posHistory.length > 1) {
        this.drawSmoothTrail(
          gfx,
          ghost.posHistory,
          RENDER.trail.ghostLineWidth,
          this.heroTrail,
          RENDER.trail.ghostAlpha,
        );
      }
    }

    for (const bot of this.botAI.getAll()) {
      if (!bot.alive) continue;
      const trail = this.trailSys.get(bot.id);
      if (!trail?.active) continue;
      if (bot.posHistory.length < 2) continue;
      this.drawSmoothTrail(
        gfx,
        bot.posHistory,
        RENDER.trail.botLineWidth,
        bot.color,
        RENDER.trail.botAlpha,
      );
    }
  }

  private drawSmoothTrail(
    gfx: Phaser.GameObjects.Graphics,
    pts: Vec2[],
    lineWidth: number,
    color: number,
    alpha: number,
  ): void {
    if (pts.length < 2) return;
    gfx.lineStyle(lineWidth, color, alpha);
    gfx.beginPath();
    const first = pts[0] as Vec2;
    gfx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const pt = pts[i] as Vec2;
      gfx.lineTo(pt.x, pt.y);
    }
    gfx.strokePath();
  }

  private renderUnits(): void {
    const gfx = this.unitGfx;
    gfx.clear();

    const heroX = this.hero.pos.x;
    const heroY = this.hero.pos.y;

    const bots = this.botAI.getAll();
    const sortedBots = bots
      .filter((b) => b.alive)
      .map((b) => ({
        bot: b,
        dist: Math.hypot(b.pos.x - heroX, b.pos.y - heroY),
      }))
      .sort((a, b2) => a.dist - b2.dist);

    for (let i = sortedBots.length - 1; i >= 0; i--) {
      const { bot, dist } = sortedBots[i]!;
      const glow = i < GLOW_BOT_COUNT ? PALETTE.botGlowNearest : PALETTE.botGlowFar;
      if (glow > 0) {
        gfx.fillStyle(bot.color, glow * 0.3);
        gfx.fillCircle(bot.pos.x, bot.pos.y, BOT_RADIUS_PX * 2.5);
      }
      void dist;
      gfx.fillStyle(bot.color, 1);
      gfx.fillCircle(bot.pos.x, bot.pos.y, BOT_RADIUS_PX);
    }

    if (this.hero.alive) {
      gfx.fillStyle(this.heroFill, PALETTE.hero.glow * 0.4);
      gfx.fillCircle(heroX, heroY, HERO_RADIUS_PX * 2.5);
      gfx.fillStyle(this.heroFill, 1);
      gfx.fillCircle(heroX, heroY, HERO_RADIUS_PX);
    }

    // Hero highlight ring (geometry-masked to own territory).
    const hl = this.heroHighlightGfx;
    if (hl) {
      hl.clear();
      if (this.hero.alive) {
        const outline = shadeColor(this.heroFill, -0.45);
        hl.lineStyle(2, outline, 0.85);
        hl.strokeCircle(heroX, heroY, HERO_RADIUS_PX);
      }
    }

    this.updateTriangleSprites(heroX, heroY);
  }

  /**
   * Drives triangle sprites: flying ghost + loaded/regrowing arrow on hero.
   * Outline twins behind the main sprites are masked to hero territory so a
   * darker rim peeks out only over own land.
   */
  private updateTriangleSprites(heroX: number, heroY: number): void {
    const triBase = SPLIT_TRI_HALF * 2.4;
    const outlineScale = 1.35;
    const heroAlive = this.hero.alive;
    const ghost = this.ghostSys.getActive();
    const ghostFlying = ghost !== null && ghost.alive;
    const now = this.time.now;

    if (this.ghostSprite) {
      if (ghostFlying) {
        const g = ghost!;
        const rot = g.heading + Math.PI / 2;
        this.ghostSprite.setVisible(true);
        this.ghostSprite.setPosition(g.pos.x, g.pos.y);
        this.ghostSprite.setRotation(rot);
        this.ghostSprite.setTint(this.heroFill);
        this.ghostSprite.setAlpha(1);

        if (this.ghostOutline) {
          const sz = triBase * 1.05 * outlineScale;
          this.ghostOutline.setVisible(true);
          this.ghostOutline.setPosition(g.pos.x, g.pos.y);
          this.ghostOutline.setRotation(rot);
          this.ghostOutline.setDisplaySize(sz, sz);
          this.ghostOutline.setAlpha(1);
        }
      } else {
        this.ghostSprite.setVisible(false);
        this.ghostOutline?.setVisible(false);
      }
    }

    if (this.splitTriSprite) {
      const hide = (): void => {
        this.splitTriSprite?.setVisible(false);
        this.splitTriOutline?.setVisible(false);
      };
      if (!heroAlive || ghostFlying) { hide(); return; }
      const ratio = Phaser.Math.Clamp(this.ghostSys.getCooldownRatio(now), 0, 1);
      if (ratio <= 0.01) { hide(); return; }

      const grow = 1 - (1 - ratio) * (1 - ratio);
      const offset =
        HERO_RADIUS_PX +
        SPLIT_TRI_GAP_MIN +
        (SPLIT_TRI_GAP_MAX - SPLIT_TRI_GAP_MIN) * grow;

      const cx = heroX + Math.cos(this.hero.heading) * offset;
      const cy = heroY + Math.sin(this.hero.heading) * offset;

      const sizeFactor = 0.35 + 0.65 * grow;
      const alpha = 0.35 + 0.65 * grow;
      let pulseScale = 1;
      if (ratio >= 1) pulseScale = 1 + 0.06 * Math.sin(now / 180);

      const px = triBase * sizeFactor * pulseScale;
      const rot = this.hero.heading + Math.PI / 2;

      this.splitTriSprite.setVisible(true);
      this.splitTriSprite.setPosition(cx, cy);
      this.splitTriSprite.setRotation(rot);
      this.splitTriSprite.setDisplaySize(px, px);
      this.splitTriSprite.setAlpha(alpha);
      this.splitTriSprite.setTint(this.heroFill);

      if (this.splitTriOutline) {
        const oSz = px * outlineScale;
        this.splitTriOutline.setVisible(true);
        this.splitTriOutline.setPosition(cx, cy);
        this.splitTriOutline.setRotation(rot);
        this.splitTriOutline.setDisplaySize(oSz, oSz);
        this.splitTriOutline.setAlpha(alpha);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rewarded continue
  // ---------------------------------------------------------------------------

  applyContinue(): void {
    if (this.phase !== "gameover") return;
    const safeCell = this.findSafeRespawnCell();
    const worldPos = this.grid.cellToWorld(safeCell);

    this.hero.pos = { x: worldPos.x, y: worldPos.y };
    this.hero.alive = true;
    this.hero.heading = 0;
    this.hero.posHistory = [];
    this.hero.velocity = { x: 0, y: 0 };

    this.trailSys.clearTrail(this.hero.id);
    this.territorySys.shrinkOwner(this.hero.id, ADS.continueRetainTerritoryPct);

    this.phase = "playing";
    this.roundEndEmitted = false;

    yandex.gameplayStart();
    this.territoryDirty = true;
    this.setupPlayCamera();

    this.scene.launch("UI", { heroId: this.hero.id });
  }

  private findSafeRespawnCell(): { cx: number; cy: number } {
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    const bots = this.botAI.getAll().filter((b) => b.alive);

    let bestCx = Math.floor(cols / 2);
    let bestCy = Math.floor(rows / 2);
    let bestDist = -1;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (this.grid.ownerOf(cx, cy) !== this.hero.id) continue;

        const wx = cx * this.grid.cellPx + this.grid.cellPx * 0.5;
        const wy = cy * this.grid.cellPx + this.grid.cellPx * 0.5;

        let minBotDist = Infinity;
        for (const bot of bots) {
          const d = Math.hypot(bot.pos.x - wx, bot.pos.y - wy);
          if (d < minBotDist) minBotDist = d;
        }

        if (minBotDist > bestDist) {
          bestDist = minBotDist;
          bestCx = cx;
          bestCy = cy;
        }
      }
    }

    return { cx: bestCx, cy: bestCy };
  }

  // ---------------------------------------------------------------------------

  shutdown(): void {
    this.game.events.off("pause:toggle", this.handlePauseToggle, this);
    this.game.events.off("pause:menu", this.handlePauseMenu, this);
    yandex.gameplayStop();
    this.ghostSys.destroy();
    this.botAI.destroy();
    this.territorySys.destroy();
    this.scoreSys.destroy();
    this.progressionSys.destroy();
    this.juiceSys.destroy();
    this.inputSys.destroy();
    this.achievementSys.destroy();
  }

  // ---------------------------------------------------------------------------
  // Pause handling
  // ---------------------------------------------------------------------------

  private handlePauseToggle(active: boolean): void {
    if (this.phase !== "playing") return;
    if (active) {
      if (this.isPaused) return;
      this.isPaused = true;
      this.pauseStartMs = this.time.now;
    } else {
      if (!this.isPaused) return;
      this.isPaused = false;
      const pausedDurationMs = this.time.now - this.pauseStartMs;
      this.roundStartMs += pausedDurationMs;
    }
  }

  private handlePauseMenu(): void {
    if (this.phase !== "playing") return;
    yandex.gameplayStop();
    this.scene.stop("UI");
    this.exitToDemo();
  }
}
