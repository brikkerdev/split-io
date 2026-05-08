import type Phaser from "phaser";
import { AUDIO } from "@config/audio";
import { GameEvents } from "@events/GameEvents";
import { saves } from "@systems/SaveManager";
import type { AdSystem } from "@systems/AdSystem";
import type { ScoreSystem } from "@systems/ScoreSystem";
import type { AchievementSystem } from "@systems/AchievementSystem";
import type { TerritorySystem } from "@systems/TerritorySystem";
import type { Hero } from "@entities/Hero";
import type { SaveV1 } from "@/types/save";
import type { RoundBreakdown } from "@gametypes/round";
import { yandex } from "@sdk/yandex";
import type { DomUI } from "@ui/dom/DomUI";
import type { CameraController } from "./CameraController";
import type { HeroController } from "./HeroController";

export type GamePhase = "demo" | "playing" | "gameover";

export interface PhaseDeps {
  hero: Hero;
  heroCtrl: HeroController;
  camera: CameraController;
  scoreSys: ScoreSystem;
  achievementSys: AchievementSystem;
  territorySys: TerritorySystem;
  adSys: AdSystem;
  domUI: DomUI;
  /** True for hero's first ever round. */
  isFirstRound: () => boolean;
  /** Called after release/spawn so renderer redraws territory. */
  markTerritoryDirty: () => void;
  emitLeaderboard: () => void;
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

    this.deps.domUI.dismountMenu();

    this.deps.heroCtrl.spawn();
    this.deps.camera.setupPlay(this.deps.hero);

    this.phase = "playing";
    this.roundStartMs = this.scene.time.now;
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.deps.adSys.resetRoundContinue();
    this.deps.achievementSys.resetRound();
    this.deps.markTerritoryDirty();

    yandex.gameplayStart();
    this.playMatchStartSfx();

    this.scene.scene.launch("UI", { heroId: this.deps.hero.id });
    this.scene.time.delayedCall(0, () => this.deps.emitLeaderboard());
  }

  endRound(): void {
    if (this.roundEndEmitted) return;
    this.roundEndEmitted = true;
    this.phase = "gameover";

    yandex.gameplayStop();

    const elapsedSec = (this.scene.time.now - this.roundStartMs) / 1000;
    const territoryPct = this.deps.territorySys.getOwnerPercent(this.deps.hero.id);
    const breakdown: RoundBreakdown = this.deps.scoreSys.finalize(elapsedSec, territoryPct);

    this.scene.events.emit(GameEvents.RoundEnd, breakdown);

    const save = saves.get<SaveV1>();
    const newBest = breakdown.total > save.bestScore;
    saves.patch({
      roundsPlayed: save.roundsPlayed + 1,
      bestScore: newBest ? breakdown.total : save.bestScore,
    });

    this.scene.time.delayedCall(400, () => {
      if (this.phase !== "gameover") return;
      this.scene.scene.stop("UI");
      this.deps.domUI.mountGameOver(
        this.scene.game,
        breakdown,
        true,
        () => this.handleContinueClick(),
        () => this.handleRestartClick(),
        () => this.handleMenuClick(),
      );
    });
  }

  restart(): void {
    this.deps.domUI.dismountGameOver();
    this.deps.heroCtrl.release(this.deps.isFirstRound());

    this.deps.heroCtrl.spawn();
    this.deps.camera.setupPlay(this.deps.hero);

    this.phase = "playing";
    this.roundStartMs = this.scene.time.now;
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.deps.adSys.resetRoundContinue();
    this.deps.achievementSys.resetRound();
    this.deps.markTerritoryDirty();

    yandex.gameplayStart();
    this.playMatchStartSfx();

    this.scene.scene.launch("UI", { heroId: this.deps.hero.id });
  }

  exitToDemo(): void {
    this.deps.domUI.dismountGameOver();
    this.deps.heroCtrl.release(this.deps.isFirstRound());
    this.deps.camera.setupDemo();

    this.phase = "demo";
    this.roundEndEmitted = false;
    this.continueUsed = false;
    this.deps.markTerritoryDirty();

    this.deps.domUI.mountMenu(this.scene.game, () => this.enterPlay());
  }

  applyContinue(): void {
    if (this.phase !== "gameover") return;
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
    this.endRound();
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
