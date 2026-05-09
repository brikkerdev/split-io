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
import { PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";
import { GhostSystem } from "@systems/GhostSystem";
import { BotAI } from "@systems/BotAI";
import { InputSystem } from "@systems/InputSystem";
import { ScoreSystem } from "@systems/ScoreSystem";
import { ProgressionSystem } from "@systems/ProgressionSystem";
import { JuiceSystem } from "@systems/JuiceSystem";
import { AudioManager } from "@systems/AudioManager";
import { AchievementSystem } from "@systems/AchievementSystem";
import { Economy } from "@systems/Economy";
import { CoinSystem } from "@systems/CoinSystem";
import { ECONOMY } from "@config/economy";
import { saves } from "@systems/SaveManager";
import { AdSystem } from "@systems/AdSystem";
import { DomUI } from "@ui/dom/DomUI";
import { yandex } from "@sdk/yandex";
import type { SaveV1 } from "@/types/save";
import type { TerritoryCapturedPayload } from "@gametypes/events";
import { shadeColor } from "@utils/color";
import { CameraController } from "./game/CameraController";
import { GameRenderer } from "./game/GameRenderer";
import { MinimapRenderer } from "./game/MinimapRenderer";
import { HeroController } from "./game/HeroController";
import { DemoController } from "./game/DemoController";
import { LeaderboardEmitter } from "./game/LeaderboardEmitter";
import { PhaseController } from "./game/PhaseController";

export class GameScene extends Phaser.Scene {
  private grid!: GridSystem;
  private trailSys!: TrailSystem;
  private territorySys!: PolygonTerritorySystem;
  private ghostSys!: GhostSystem;
  private botAI!: BotAI;
  private inputSys!: InputSystem;
  private scoreSys!: ScoreSystem;
  private progressionSys!: ProgressionSystem;
  private juiceSys!: JuiceSystem;
  private achievementSys!: AchievementSystem;
  private economy!: Economy;
  private coinSys!: CoinSystem;

  private hero!: Hero;

  private camera!: CameraController;
  private gameRenderer!: GameRenderer;
  private minimap!: MinimapRenderer;
  private heroCtrl!: HeroController;
  private demoCtrl!: DemoController;
  private leaderboard!: LeaderboardEmitter;
  private phaseCtrl!: PhaseController;

  private adSys = new AdSystem();
  private domUI = DomUI.get();
  private audioManager!: AudioManager;

  private heroFill: number = PALETTE.hero.fill;
  private heroTerritory: number = PALETTE.hero.territory;
  private heroTrail: number = PALETTE.hero.trail;
  private heroPattern: import("@config/skinPatterns").PatternId = "solid";
  private heroFillSecondary: number | undefined;

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
    this.minimap.init();
    this.camera.init();
    this.phaseCtrl.reset();

    this.bindEvents();
    this.demoCtrl.spawnBots();
    this.camera.setupDemo();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    this.game.events.on(GameEvents.RoundContinue, this.applyContinue, this);

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
        this.tickRaidFx(dt);
      }
    }

    const botsActive = phase !== "playing" || !isPaused;
    if (botsActive) this.botAI.update(dt);

    if (phase === "demo") {
      this.demoCtrl.tickFairness(dt);
    }

    this.gameRenderer.render();

    const showMinimap = phase !== "demo";
    this.minimap.setVisible(showMinimap);
    if (showMinimap) this.minimap.render();
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
    this.heroPattern = skinDef.pattern;
    this.heroFillSecondary = skinDef.fillSecondary;
  }

  private initSystems(save: SaveV1): void {
    this.grid = new GridSystem();
    this.territorySys = new PolygonTerritorySystem(this, MAP.radiusPx, MAP.centerX, MAP.centerY);
    this.trailSys = new TrailSystem(this, this.territorySys);
    this.scoreSys = new ScoreSystem(this);
    this.audioManager = new AudioManager(this);
    this.juiceSys = new JuiceSystem(this, this.audioManager);

    this.hero = new Hero();
    this.hero.speedCellsPerSec = BALANCE.heroBaseSpeedCellsPerSec;
    this.hero.alive = false;
    this.hero.pos = { x: MAP.centerX, y: MAP.centerY };
    this.juiceSys.setHeroId(this.hero.id);
    this.juiceSys.setHero(this.hero);
    this.scoreSys.setHeroId(this.hero.id);

    // ProgressionSystem needs hero reference; cycleReset callback provided later
    // via initControllers where phaseCtrl is available.
    this.progressionSys = new ProgressionSystem(this, this.hero, (fullCycle) => {
      if (fullCycle) {
        this.phaseCtrl.cycleReset();
      } else {
        this.phaseCtrl.resumeAfterUpgrade();
      }
    });

    this.ghostSys = new GhostSystem(this, this.hero, this.trailSys, this.territorySys, this.grid);
    if (this.isFirstRound) {
      this.ghostSys.setCooldownSec(BALANCE.splitCooldownFirstRoundSec);
    }
    this.juiceSys.setGhostIdProvider(() => this.ghostSys.getActive()?.id ?? null);

    this.trailSys.setPeerGroup(this.hero.id, [this.hero.id]);

    this.botAI = new BotAI(this, this.grid, this.trailSys, this.hero, this.territorySys);

    const scheme = save.settings.controlScheme;
    this.inputSys = new InputSystem(this, scheme);
    this.inputSys.init();

    // Apply control-scheme changes from the settings modal at runtime.
    this.game.events.on(GameEvents.ControlSchemeChanged, this.onControlSchemeChanged, this);

    // Reapply skin when player picks one in the skins modal.
    this.game.events.on(GameEvents.SkinChanged, this.onSkinChanged, this);

    this.economy = new Economy({
      startingCoins: save.coins ?? ECONOMY.startingCoins,
      rewardMultiplier: ECONOMY.rewardMultiplier,
      costGrowthRate: ECONOMY.costGrowthRate,
    });
    this.coinSys = new CoinSystem(this, this.economy);
    this.coinSys.setHeroId(this.hero.id);
    this.coinSys.setGhostIdProvider(() => this.ghostSys.getActive()?.id ?? null);
    this.coinSys.setHeroPosProvider(() =>
      this.hero.alive ? { x: this.hero.pos.x, y: this.hero.pos.y } : null,
    );
    this.coinSys.reset();

    this.achievementSys = new AchievementSystem(this, this.hero.id, this.coinSys);
    this.achievementSys.resetRound();
  }

  private initControllers(): void {
    this.camera = new CameraController(this);

    this.gameRenderer = new GameRenderer(this, {
      grid: this.grid,
      trails: this.trailSys,
      botAI: this.botAI,
      territory: this.territorySys,
      ghostSys: () => this.ghostSys,
      hero: this.hero,
      heroFill: () => this.heroFill,
      heroTerritory: () => this.heroTerritory,
      heroTrail: () => this.heroTrail,
      heroPattern: () => this.heroPattern,
      heroFillSecondary: () => this.heroFillSecondary,
    });

    this.minimap = new MinimapRenderer(this, {
      territory: this.territorySys,
      botAI: this.botAI,
      hero: this.hero,
      heroFill: () => this.heroFill,
      heroTerritory: () => this.heroTerritory,
    });

    this.heroCtrl = new HeroController(this, {
      hero: this.hero,
      grid: this.grid,
      trails: this.trailSys,
      territory: this.territorySys,
      ghostSys: () => this.ghostSys,
      rebuildGhost: () => {
        this.ghostSys = new GhostSystem(this, this.hero, this.trailSys, this.territorySys, this.grid);
        return this.ghostSys;
      },
      botAI: this.botAI,
      input: this.inputSys,
      heroFill: () => this.heroFill,
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
      progressionSys: this.progressionSys,
      botAI: this.botAI,
      ghostSys: () => this.ghostSys,
      adSys: this.adSys,
      coinSys: this.coinSys,
      domUI: this.domUI,
      isFirstRound: () => this.isFirstRound,
      markTerritoryDirty: () => this.gameRenderer.markTerritoryDirty(),
      emitLeaderboard: () => this.leaderboard.emit(),
      releaseCycleTerritory: () => this.releaseCycleTerritory(),
    });
  }

  /** Resolve the territory color under the hero, or null if neutral / hero's own. */
  private resolveEnemyTerritoryColor(): number | null {
    const owner = this.territorySys.ownerAt(this.hero.pos.x, this.hero.pos.y);
    if (owner === 0 || owner === this.hero.id) return null;
    const bot = this.botAI.getAll().find((b) => b.id === owner);
    return bot?.color ?? null;
  }

  private tickRaidFx(dt: number): void {
    const victimColor = this.resolveEnemyTerritoryColor();
    this.juiceSys.updateRaid(dt, victimColor !== null, victimColor);

    // Task 3 + 4: ambient particles and tension layer when outside own territory.
    const heroOwner = this.territorySys.ownerAt(this.hero.pos.x, this.hero.pos.y);
    const outsideOwn = this.hero.alive && heroOwner !== this.hero.id;
    this.juiceSys.setHeroOutsideOwnTerritory(outsideOwn, this.heroFill);
    this.juiceSys.tickAmbientOutside(dt);

    // Task 15: split-ready glow.
    const splitRatio = this.ghostSys.getCooldownRatio(this.time.now);
    this.juiceSys.tickSplitCooldown(splitRatio);
  }

  private releaseCycleTerritory(): void {
    // Clear all bots' trails and territory so the map is fresh for next cycle.
    for (const bot of this.botAI.getAll()) {
      this.trailSys.clearTrail(bot.id);
      this.territorySys.release(bot.id);
    }
    // Hero territory and trail are released by heroCtrl.release() in cycleReset.
  }

  private readonly onControlSchemeChanged = (next: "swipe" | "joystick"): void => {
    this.inputSys.setScheme(next);
  };

  private readonly onSkinChanged = (): void => {
    this.applySkin(saves.get<SaveV1>());
    this.gameRenderer.markTerritoryDirty();
    this.leaderboard.emit();
  };

  private readonly onUpgradePicked = (id: import("@config/upgrades").UpgradeId): void => {
    this.phaseCtrl.applyUpgradeAndContinueCycle(id);
  };

  private readonly onVictory = (): void => {
    this.phaseCtrl.enterVictory();
  };

  private readonly onUpgradeOffer = (): void => {
    this.phaseCtrl.enterUpgradePick();
  };

  private readonly onTrailCut = (payload: { victim: number; killer: number }): void => {
    if (payload.victim === this.hero.id) {
      this.heroCtrl.emitDied("trail_cut");
      this.phaseCtrl.handlePlayerDeath();
      return;
    }
    const bot = this.botAI.getAll().find((b) => b.id === payload.victim);
    if (bot) this.demoCtrl.scheduleBotRespawn(bot.id);
  };

  private readonly onBotDissolveStart = (payload: { ownerId: number }): void => {
    this.gameRenderer.startDissolve(payload.ownerId);
  };

  private readonly onGhostSpawned = (_payload: { pos: { x: number; y: number }; heading: number }): void => {
    const ghost = this.ghostSys.getActive();
    if (ghost) {
      this.trailSys.setPeerGroup(this.hero.id, [this.hero.id, ghost.id]);
    }
  };

  private readonly onGhostDestroyed = (): void => {
    this.trailSys.setPeerGroup(this.hero.id, [this.hero.id]);
  };

  private readonly onTerritoryUpdate = (): void => {
    this.gameRenderer.markTerritoryDirty();
    this.leaderboard.emit();
  };

  private readonly onTerritoryCaptured = (_payload: TerritoryCapturedPayload): void => {
    this.gameRenderer.markTerritoryDirty();
  };

  private readonly onPlayerDied = (): void => {
    this.leaderboard.emit();
    this.gameRenderer.startDissolve(this.hero.id);
  };

  private bindEvents(): void {
    this.game.events.on("upgrade:picked", this.onUpgradePicked, this);
    this.events.on(GameEvents.Victory, this.onVictory, this);
    this.events.on(GameEvents.UpgradeOffer, this.onUpgradeOffer, this);
    this.events.on(GameEvents.TrailCut, this.onTrailCut, this);
    this.events.on("bot:dissolveStart", this.onBotDissolveStart, this);
    this.events.on(GameEvents.GhostSpawned, this.onGhostSpawned, this);
    this.events.on(GameEvents.GhostDestroyed, this.onGhostDestroyed, this);
    this.events.on(GameEvents.TerritoryUpdate, this.onTerritoryUpdate, this);
    this.events.on(GameEvents.TerritoryCaptured, this.onTerritoryCaptured, this);
    this.events.on(GameEvents.PlayerDied, this.onPlayerDied, this);
    this.game.events.on("pause:toggle", this.handlePauseToggle, this);
    this.game.events.on("pause:menu", this.handlePauseMenu, this);
  }

  private applyContinue(): void {
    // Restoring territory — cancel any in-flight dissolve so it stays visible.
    this.gameRenderer.cancelDissolve(this.hero.id);
    this.phaseCtrl.applyContinue();
  }

  private handlePauseToggle(active: boolean): void {
    this.phaseCtrl.handlePauseToggle(active);
  }

  private handlePauseMenu(): void {
    this.phaseCtrl.handlePauseMenu();
  }

  shutdown(): void {
    this.game.events.off("upgrade:picked", this.onUpgradePicked, this);
    this.game.events.off(GameEvents.RoundContinue, this.applyContinue, this);
    this.game.events.off(GameEvents.ControlSchemeChanged, this.onControlSchemeChanged, this);
    this.game.events.off(GameEvents.SkinChanged, this.onSkinChanged, this);
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
    this.coinSys.destroy();
  }
}
