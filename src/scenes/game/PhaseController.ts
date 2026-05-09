import type Phaser from "phaser";
import { AUDIO } from "@config/audio";
import { GameEvents } from "@events/GameEvents";
import { saves } from "@systems/SaveManager";
import type { AdSystem } from "@systems/AdSystem";
import type { ScoreSystem } from "@systems/ScoreSystem";
import type { AchievementSystem } from "@systems/AchievementSystem";
import type { PolygonTerritorySystem } from "@systems/PolygonTerritorySystem";
import type { ProgressionSystem } from "@systems/ProgressionSystem";
import type { BotAI } from "@systems/BotAI";
import type { GhostSystem } from "@systems/GhostSystem";
import type { CoinSystem } from "@systems/CoinSystem";
import type { Hero } from "@entities/Hero";
import type { SaveV1 } from "@/types/save";
import type { RoundBreakdown } from "@gametypes/round";
import { yandex } from "@sdk/yandex";
import { GHOST } from "@config/ghost";
import { SCORE } from "@config/score";
import { JUICE } from "@config/juice";
import { locale } from "@systems/Locale";
import type { DomUI } from "@ui/dom/DomUI";
import type { CameraController } from "./CameraController";
import type { HeroController } from "./HeroController";

export type GamePhase = "demo" | "playing" | "gameover" | "upgradePick" | "victory";

export interface PhaseDeps {
  hero: Hero;
  heroCtrl: HeroController;
  camera: CameraController;
  scoreSys: ScoreSystem;
  achievementSys: AchievementSystem;
  territorySys: PolygonTerritorySystem;
  progressionSys: ProgressionSystem;
  botAI: BotAI;
  ghostSys: () => GhostSystem;
  adSys: AdSystem;
  coinSys: CoinSystem;
  domUI: DomUI;
  /** True for hero's first ever round. */
  isFirstRound: () => boolean;
  /** Called after release/spawn so renderer redraws territory. */
  markTerritoryDirty: () => void;
  emitLeaderboard: () => void;
  /** Release all territory + trails so cycle can restart. */
  releaseCycleTerritory: () => void;
}

export class PhaseController {
  private phase: GamePhase = "demo";
  private roundStartMs = 0;
  private roundEndEmitted = false;
  private continueUsed = false;
  private isPaused = false;
  private pauseStartMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: PhaseDeps,
  ) {}

  // ── Getters ──
  getPhase(): GamePhase { return this.phase; }
  setPhase(p: GamePhase): void { this.phase = p; }
  paused(): boolean { return this.isPaused; }

  // ── Lifecycle ──

  reset(): void {
    this.phase = "demo";
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.isPaused = false;
    this.pauseStartMs = 0;
  }

  enterPlay(): void {
    if (this.phase === "playing") return;

    this.isPaused = false;
    this.pauseStartMs = 0;

    this.deps.domUI.dismountMenu();
    void yandex.hideBanner();

    this.deps.heroCtrl.spawn();
    this.deps.camera.setupPlay(this.deps.hero);

    this.phase = "playing";
    this.roundStartMs = this.scene.time.now;
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.deps.adSys.resetRoundContinue();
    this.deps.achievementSys.resetRound();
    this.deps.scoreSys.reset();
    this.deps.coinSys.reset();
    this.deps.progressionSys.reset();
    this.deps.markTerritoryDirty();

    yandex.gameplayStart();
    this.playMatchStartSfx();

    this.scene.scene.launch("UI", { heroId: this.deps.hero.id });
    this.scene.time.delayedCall(0, () => this.deps.emitLeaderboard());

    this.maybeShowTutorial();
  }

  private maybeShowTutorial(): void {
    const save = saves.get<SaveV1>();
    if (save.tutorialShown) return;
    if (!this.deps.isFirstRound()) return;
    this.scene.time.delayedCall(400, () => {
      if (this.phase !== "playing") return;
      this.deps.domUI.mountTutorial(
        this.scene.game,
        this.scene.events,
        () => (this.deps.hero.alive ? { x: this.deps.hero.pos.x, y: this.deps.hero.pos.y } : null),
        () => saves.patch({ tutorialShown: true }),
      );
    });
  }

  endRound(): void {
    if (this.roundEndEmitted) return;
    this.roundEndEmitted = true;
    this.phase = "gameover";

    this.deps.domUI.dismountTutorial();
    yandex.gameplayStop();

    const elapsedSec = (this.scene.time.now - this.roundStartMs) / 1000;
    const territoryPct = this.deps.territorySys.getOwnerPercent(this.deps.hero.id);
    const breakdown: RoundBreakdown = this.deps.scoreSys.finalize(elapsedSec, territoryPct);

    this.scene.events.emit(GameEvents.RoundEnd, breakdown);
    this.scene.events.emit(GameEvents.PreGameOver);

    const coinsEarned = this.deps.coinSys.getRoundCoins();

    const save = saves.get<SaveV1>();
    const newBest = breakdown.total > save.bestScore;
    saves.patch({
      roundsPlayed: save.roundsPlayed + 1,
      bestScore: newBest ? breakdown.total : save.bestScore,
      coins: this.deps.coinSys.getTotalCoins(),
    });

    const deathPos = { x: this.deps.hero.pos.x, y: this.deps.hero.pos.y };

    void this.deps.camera.postMortemZoom(deathPos).then(() => {
      if (this.phase !== "gameover") return;
      this.scene.scene.stop("UI");
      this.deps.domUI.mountGameOver(
        this.scene.game,
        breakdown,
        true,
        coinsEarned,
        () => this.handleContinueClick(),
        () => this.handleDoubleCoinsClick(coinsEarned),
        () => this.handleRestartClick(),
        () => this.handleMenuClick(),
      );
    });
  }

  restart(): void {
    this.deps.domUI.dismountGameOver();
    this.deps.camera.clearDeathOverlay();
    this.deps.heroCtrl.release(this.deps.isFirstRound());

    this.deps.heroCtrl.spawn();
    this.deps.camera.setupPlay(this.deps.hero);

    this.phase = "playing";
    this.roundStartMs = this.scene.time.now;
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.deps.adSys.resetRoundContinue();
    this.deps.achievementSys.resetRound();
    this.deps.scoreSys.reset();
    this.deps.coinSys.reset();
    this.deps.progressionSys.reset();
    this.deps.markTerritoryDirty();

    yandex.gameplayStart();
    this.playMatchStartSfx();

    this.scene.scene.launch("UI", { heroId: this.deps.hero.id });
  }

  exitToDemo(): void {
    this.deps.domUI.dismountTutorial();
    this.deps.domUI.dismountGameOver();
    this.deps.camera.clearDeathOverlay();
    this.deps.heroCtrl.release(this.deps.isFirstRound());
    this.deps.camera.setupDemo();

    this.phase = "demo";
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.isPaused = false;
    this.pauseStartMs = 0;
    this.deps.markTerritoryDirty();

    this.deps.domUI.mountMenu(this.scene.game, () => this.enterPlay());
    void yandex.showBanner();
    void this.maybePromptShortcut();
  }

  private async maybePromptShortcut(): Promise<void> {
    const save = saves.get<SaveV1>();
    if (save.shortcutPromptShown) return;
    if (save.roundsPlayed < 1) return;
    saves.patch({ shortcutPromptShown: true });
    await yandex.maybeShowShortcutPrompt();
  }

  applyContinue(): void {
    if (this.phase !== "gameover") return;
    this.deps.camera.clearDeathOverlay();
    this.deps.heroCtrl.applyContinue();

    this.phase = "playing";
    this.roundEndEmitted = false;

    yandex.gameplayStart();
    this.deps.markTerritoryDirty();
    this.deps.camera.setupPlay(this.deps.hero);

    this.scene.scene.launch("UI", { heroId: this.deps.hero.id });
  }

  handlePlayerDeath(): void {
    if (this.phase !== "playing") return;
    this.deps.scoreSys.addPenalty(SCORE.deathPenalty);
    this.endRound();
  }

  // ── Upgrade pick ─────────────────────────────────────────

  enterUpgradePick(): void {
    this.phase = "upgradePick";
    yandex.gameplayStop();
  }

  /** Called by DomUI after player picks an upgrade card. */
  applyUpgradeAndContinueCycle(id: import("@config/upgrades").UpgradeId): void {
    // Applies upgrade and invokes resumeAfterUpgrade (sub-cycle) or cycleReset (full 100%).
    this.deps.progressionSys.applyUpgrade(id);
  }

  /** Sub-threshold (25/50/75%) upgrade pick: resume play without map reset. */
  resumeAfterUpgrade(): void {
    this.phase = "playing";
    yandex.gameplayStart();
  }

  /** Called when ProgressionSystem reports a full-cycle (100%) upgrade — resets map. */
  cycleReset(): void {
    const cycle = this.deps.progressionSys.getCycleCount();
    const cfg = JUICE.cycleTransition;
    const cam = this.scene.cameras.main;
    const { r, g, b } = cfg.fadeColor;

    // Pre-flash for impact, then slow time briefly while we fade out.
    cam.flash(cfg.flashDurationMs, cfg.flashColor.r, cfg.flashColor.g, cfg.flashColor.b);
    this.scene.time.timeScale = cfg.slowMoScale;
    this.scene.tweens.timeScale = cfg.slowMoScale;

    cam.once(
      "camerafadeoutcomplete",
      () => {
        this.scene.time.timeScale = 1;
        this.scene.tweens.timeScale = 1;
        this.runCycleResetWork(cycle);
        cam.fadeIn(cfg.fadeInMs, r, g, b);
        this.spawnCycleBanner(cycle);
      },
    );
    cam.fadeOut(cfg.fadeOutMs, r, g, b);
  }

  private runCycleResetWork(cycle: number): void {
    // Buff bots for next cycle.
    this.deps.botAI.applyCycleBuff();

    // Release all territory and trails.
    this.deps.releaseCycleTerritory();

    // Respawn hero at random position.
    this.deps.heroCtrl.release(false);
    this.deps.heroCtrl.spawn();

    // Respawn bots.
    this.deps.botAI.respawnAll();

    // Update ghost cooldown based on accumulated reduction.
    const ghost = this.deps.ghostSys();
    const reduction = this.deps.hero.ghostCooldownReductionSec;
    ghost.setCooldownSec(
      Math.max(GHOST.cooldownMinSec, GHOST.cooldownBaseSec - reduction),
    );

    this.deps.markTerritoryDirty();
    this.deps.emitLeaderboard();

    this.phase = "playing";
    this.roundStartMs = this.scene.time.now;
    this.roundEndEmitted = false;

    yandex.gameplayStart();
    this.playMatchStartSfx();

    // Cycle HUD label update.
    this.scene.events.emit(GameEvents.CycleStart, { cycle });
  }

  private spawnCycleBanner(cycle: number): void {
    const cfg = JUICE.cycleTransition.banner;
    const cam = this.scene.cameras.main;
    const text = locale.t("cycle_label").replace("%{n}", String(cycle));

    const label = this.scene.add
      .text(cam.scrollX + cam.width / 2, cam.scrollY + cam.height / 2, text, {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: `${cfg.fontSize}px`,
        color: cfg.color,
        stroke: cfg.strokeColor,
        strokeThickness: cfg.strokeThickness,
      })
      .setScrollFactor(0)
      .setDepth(1100)
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.5);

    this.scene.tweens.add({
      targets: label,
      scale: 1,
      alpha: 1,
      duration: cfg.scaleInDurationMs,
      ease: "Back.easeOut",
    });
    this.scene.tweens.add({
      targets: label,
      alpha: 0,
      scale: 1.18,
      delay: cfg.scaleInDurationMs + cfg.holdMs,
      duration: cfg.fadeOutMs,
      ease: "Quad.easeIn",
      onComplete: () => label.destroy(),
    });

    // Settle shake once the banner is visible. Shake the UI overlay (DOM), not the camera.
    this.scene.time.delayedCall(cfg.scaleInDurationMs * 0.5, () => {
      const overlay = typeof document !== "undefined"
        ? document.getElementById("ui-overlay")
        : null;
      if (!overlay) return;
      const cls = JUICE.cycleTransition.shakeIntensity >= 0.01 ? "shake-lg" : "shake-sm";
      overlay.classList.remove("shake-sm", "shake-lg");
      requestAnimationFrame(() => {
        overlay.classList.add(cls);
        globalThis.setTimeout(
          () => overlay.classList.remove(cls),
          JUICE.cycleTransition.shakeDurationMs + 40,
        );
      });
    });
  }

  // ── Victory ──────────────────────────────────────────────

  enterVictory(): void {
    this.phase = "victory";
    yandex.gameplayStop();

    // Unlock master_loop achievement.
    this.deps.achievementSys.tryUnlock("master_loop");

    const cycle = this.deps.progressionSys.getCycleCount();
    const score = this.deps.scoreSys.getCurrentScore();

    this.scene.time.delayedCall(400, () => {
      if (this.phase !== "victory") return;
      this.scene.scene.stop("UI");
      this.deps.domUI.mountVictory(
        this.scene.game,
        { cycle, score },
        () => this.deps.emitLeaderboard(),
        () => this.handleMenuClick(),
      );
    });
  }

  // ── Pause ──

  handlePauseToggle(active: boolean): void {
    if (this.phase !== "playing") return;
    if (active) {
      if (this.isPaused) return;
      this.isPaused = true;
      this.pauseStartMs = this.scene.time.now;
    } else {
      if (!this.isPaused) return;
      this.isPaused = false;
      const pausedDurationMs = this.scene.time.now - this.pauseStartMs;
      this.roundStartMs += pausedDurationMs;
    }
  }

  handlePauseMenu(): void {
    if (this.phase !== "playing") return;
    yandex.gameplayStop();
    this.scene.scene.stop("UI");
    this.exitToDemo();
  }

  // ── Click handlers (for game over modal) ──

  private async handleDoubleCoinsClick(coinsEarned: number): Promise<void> {
    if (coinsEarned <= 0) return;
    const ok = await this.deps.adSys.showRewarded("doubleCoins");
    if (!ok) return;
    this.deps.coinSys.addCoins(coinsEarned);
    saves.patch({ coins: this.deps.coinSys.getTotalCoins() });
  }

  private async handleContinueClick(): Promise<void> {
    if (this.continueUsed) return;
    const granted = await this.deps.adSys.showRewarded("continue");
    if (!granted) return;
    this.continueUsed = true;
    this.deps.domUI.dismountGameOver();
    this.scene.game.events.emit(GameEvents.RoundContinue);
  }

  private async handleRestartClick(): Promise<void> {
    await this.deps.adSys.showInterstitial();
    this.restart();
  }

  private handleMenuClick(): void {
    try { this.scene.sound.stopAll(); } catch { /* silent */ }
    this.deps.domUI.dismountVictory();
    this.deps.camera.clearDeathOverlay();
    this.exitToDemo();
  }

  private playMatchStartSfx(): void {
    try {
      this.scene.sound.stopAll();
      if (this.scene.cache.audio.exists(AUDIO.sfx.matchStart)) {
        this.scene.sound.play(AUDIO.sfx.matchStart, { volume: 0.7 });
      }
    } catch { /* silent */ }
  }
}
