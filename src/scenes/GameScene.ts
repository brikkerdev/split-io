import Phaser from "phaser";
import { BALANCE } from "@config/balance";
import { GRID } from "@config/grid";
import { MAP } from "@config/map";
import { PALETTE } from "@config/palette";
import { SKINS } from "@config/skins";
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
import { yandex } from "@sdk/yandex";
import type { SaveV1 } from "@/types/save";
import type { TerritoryCapturedPayload } from "@gametypes/events";
import { shadeColor } from "@utils/color";
import { CameraController } from "./game/CameraController";
import { GameRenderer } from "./game/GameRenderer";
import { HeroController } from "./game/HeroController";
import { DemoController } from "./game/DemoController";
import { LeaderboardEmitter } from "./game/LeaderboardEmitter";
import { PhaseController } from "./game/PhaseController";

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

  private camera!: CameraController;
  private gameRenderer!: GameRenderer;
  private heroCtrl!: HeroController;
  private demoCtrl!: DemoController;
  private leaderboard!: LeaderboardEmitter;
  private phaseCtrl!: PhaseController;

  private adSys = new AdSystem();
  private domUI = DomUI.get();

  private heroFill: number = PALETTE.hero.fill;
  private heroTerritory: number = PALETTE.hero.territory;
  private heroTrail: number = PALETTE.hero.trail;

  private isFirstRound = false;
  private firstRoundPassiveTimer = 0;

  constructor() {
    super("Game");
  }

  create(): void {
    this.firstRoundPassiveTimer = 0;

    const save = saves.get<SaveV1>();
    this.isFirstRound = save.roundsPlayed === 0;
    this.game.sound.volume = save.settings.sfxVolume ?? 1.0;

    this.applySkin(save);
    this.adSys.resetRoundContinue();

    this.initSystems(save);
    this.initControllers();

    this.gameRenderer.init();
    this.camera.init();
    this.phaseCtrl.reset();

    this.bindEvents();
    this.demoCtrl.spawnBots();
    this.camera.setupDemo();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    this.game.events.on(GameEvents.RoundContinue, this.applyContinue, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(GameEvents.RoundContinue, this.applyContinue, this);
    }, this);

    try { this.sound.stopAll(); } catch { /* silent */ }

    this.domUI.mountMenu(this.game, () => this.phaseCtrl.enterPlay());

    this.time.delayedCall(0, () => this.leaderboard.emit());
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const phase = this.phaseCtrl.getPhase();
    const isPaused = this.phaseCtrl.paused();

    if (phase === "playing" && !isPaused) {
      if (this.isFirstRound && this.firstRoundPassiveTimer < BALANCE.botFirstRoundPassiveSec) {
        this.firstRoundPassiveTimer += dt;
      }
      this.inputSys.update(delta, this.hero.pos.x, this.hero.pos.y);
      const cause = this.heroCtrl.move(dt);
      if (cause !== null) {
        this.heroCtrl.emitDied(cause);
        this.phaseCtrl.handlePlayerDeath();
      } else {
        this.camera.update(this.hero);
        this.ghostSys.update(dt, this.time.now, this.hero);
        this.progressionSys.onTerritoryPct(
          this.territorySys.getOwnerPercent(this.hero.id),
        );
      }
    }

    const botsActive = phase !== "playing" || !isPaused;
    if (botsActive) this.botAI.update(dt);

    if (phase === "demo") {
      this.demoCtrl.tickFairness(dt);
    }

    this.gameRenderer.render();
  }

  // ── Init ──

  private applySkin(save: SaveV1): void {
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
    this.heroTerritory = skinDef.fill;
    this.heroTrail = shadeColor(skinDef.fill, 0.2);
  }

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

  private initControllers(): void {
    this.camera = new CameraController(this);

    this.gameRenderer = new GameRenderer(this, {
      grid: this.grid,
      trails: this.trailSys,
      botAI: this.botAI,
      ghostSys: () => this.ghostSys,
      hero: this.hero,
      heroFill: () => this.heroFill,
      heroTerritory: () => this.heroTerritory,
      heroTrail: () => this.heroTrail,
    });

    this.heroCtrl = new HeroController(this, {
      hero: this.hero,
      grid: this.grid,
      trails: this.trailSys,
      territory: this.territorySys,
      ghostSys: () => this.ghostSys,
      rebuildGhost: () => {
        this.ghostSys = new GhostSystem(this, this.hero, this.trailSys);
        return this.ghostSys;
      },
      botAI: this.botAI,
      input: this.inputSys,
    });

    this.demoCtrl = new DemoController(this, {
      grid: this.grid,
      botAI: this.botAI,
      territory: this.territorySys,
      markTerritoryDirty: () => this.gameRenderer.markTerritoryDirty(),
    });

    this.leaderboard = new LeaderboardEmitter(this, {
      hero: this.hero,
      heroFill: () => this.heroFill,
      botAI: this.botAI,
      territory: this.territorySys,
      isDemoPhase: () => this.phaseCtrl.getPhase() === "demo",
    });

    this.phaseCtrl = new PhaseController(this, {
      hero: this.hero,
      heroCtrl: this.heroCtrl,
      camera: this.camera,
      scoreSys: this.scoreSys,
      achievementSys: this.achievementSys,
      territorySys: this.territorySys,
      adSys: this.adSys,
      domUI: this.domUI,
      isFirstRound: () => this.isFirstRound,
      markTerritoryDirty: () => this.gameRenderer.markTerritoryDirty(),
      emitLeaderboard: () => this.leaderboard.emit(),
    });
  }

  private bindEvents(): void {
    this.events.on(GameEvents.TrailCut, (payload: { victim: number; killer: number }) => {
      if (payload.victim === this.hero.id) {
        this.heroCtrl.emitDied("trail_cut");
        this.phaseCtrl.handlePlayerDeath();
        return;
      }
      const bot = this.botAI.getAll().find((b) => b.id === payload.victim);
      if (bot) this.demoCtrl.scheduleBotRespawn(bot.id);
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
      this.gameRenderer.markTerritoryDirty();
      this.leaderboard.emit();
    });
    this.events.on(GameEvents.TerritoryCaptured, (_payload: TerritoryCapturedPayload) => {
      this.gameRenderer.markTerritoryDirty();
    });

    this.events.on(GameEvents.PlayerDied, () => this.leaderboard.emit());

    this.game.events.on("pause:toggle", this.handlePauseToggle, this);
    this.game.events.on("pause:menu", this.handlePauseMenu, this);
  }

  private applyContinue(): void {
    this.phaseCtrl.applyContinue();
  }

  private handlePauseToggle(active: boolean): void {
    this.phaseCtrl.handlePauseToggle(active);
  }

  private handlePauseMenu(): void {
    this.phaseCtrl.handlePauseMenu();
  }

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
}
