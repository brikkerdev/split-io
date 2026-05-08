import Phaser from "phaser";
import { DomUI } from "@ui/dom/DomUI";
import { AdSystem } from "@systems/AdSystem";
import { AUDIO } from "@config/audio";
import { GameEvents } from "@events/GameEvents";
import type { RoundBreakdown } from "@gametypes/round";

interface GameOverData {
  breakdown: RoundBreakdown;
  isDeath: boolean;
}

export class GameOverScene extends Phaser.Scene {
  private adSys = new AdSystem();
  private domUI = DomUI.get();
  private continueUsed = false;

  constructor() {
    super("GameOver");
  }

  create(data: GameOverData): void {
    const breakdown = data.breakdown ?? this.emptyBreakdown();
    const isDeath = data.isDeath ?? true;

    this.cameras.main.setBackgroundColor("#05060d");

    this.domUI.mountGameOver(
      this.game,
      breakdown,
      isDeath,
      () => this.handleContinue(),
      () => this.handleRetry(),
      () => this.goMenu(),
    );

    try { this.sound.play(AUDIO.music.gameoverStinger, { volume: 0.7 }); } catch { /* silent */ }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.domUI.dismountGameOver();
    });
  }

  private async handleRetry(): Promise<void> {
    await this.adSys.showInterstitial();
    this.scene.stop("GameOver");
    this.scene.start("Game");
    this.scene.launch("UI");
  }

  private async handleContinue(): Promise<void> {
    if (this.continueUsed) return;
    const granted = await this.adSys.showRewarded("continue");
    if (!granted) return;
    this.continueUsed = true;
    this.scene.stop("GameOver");
    this.game.events.emit(GameEvents.RoundContinue);
  }

  private goMenu(): void {
    try { this.sound.stopAll(); } catch { /* silent */ }
    this.scene.stop("GameOver");
    this.scene.stop("UI");
    this.scene.start("Menu");
  }

  private emptyBreakdown(): RoundBreakdown {
    return {
      territoryPct: 0,
      territoryPoints: 0,
      secondsBonus: 0,
      kills: 0,
      killPoints: 0,
      penalty: 0,
      total: 0,
      rank: -1,
      bestNew: false,
    };
  }
}
