/**
 * DomUI — central controller for HTML overlay UI.
 * Owns the #ui-overlay div, mounts/unmounts screens.
 * Called from Phaser scenes via static methods.
 */
import Phaser from "phaser";
import { DomHUD } from "./DomHUD";
import { DomMenu } from "./DomMenu";
import { DomGameOver } from "./DomGameOver";
import { DomUpgradeModal } from "./DomUpgradeModal";
import { DomVictory } from "./DomVictory";
import type { VictoryStats } from "./DomVictory";
import { DomPause } from "./DomPause";
import { DomSkinsModal } from "./DomSkinsModal";
import { DomSettingsModal } from "./DomSettingsModal";
import { DomAchievementsModal } from "./DomAchievementsModal";
import { DomLeaderboardModal } from "./DomLeaderboardModal";
import { DomDailyModal } from "./DomDailyModal";
import { DomAchievementToast } from "./DomAchievementToast";
import { DomTutorial } from "./DomTutorial";
import { AUDIO } from "@config/audio";
import { GameEvents } from "@events/GameEvents";
import { yandex } from "@sdk/yandex";
import type { RoundBreakdown } from "@gametypes/round";
import type { UpgradeOfferPayload } from "@gametypes/events";
import type { UpgradeId } from "@config/upgrades";

// Singleton instance
let instance: DomUI | null = null;

export class DomUI {
  private hud: DomHUD | null = null;
  private menu: DomMenu | null = null;
  private gameOver: DomGameOver | null = null;
  private upgradeModal: DomUpgradeModal | null = null;
  private victoryScreen: DomVictory | null = null;
  private pauseModal: DomPause | null = null;
  private skinsModal: DomSkinsModal | null = null;
  private settingsModal: DomSettingsModal | null = null;
  private achievementsModalEl: HTMLElement | null = null;
  private leaderboardModal: DomLeaderboardModal | null = null;
  private dailyModal: DomDailyModal | null = null;
  private tutorial: DomTutorial | null = null;
  private pauseGame: Phaser.Game | null = null;
  private onPauseToggle: ((active: boolean) => void) | null = null;
  private hudGameEvents: Phaser.Events.EventEmitter | null = null;
  private onUpgradeOfferBound: ((payload: UpgradeOfferPayload) => void) | null = null;

  static get(): DomUI {
    if (!instance) instance = new DomUI();
    return instance;
  }

  // ── Overlay init ──────────────────────────────────────────

  /**
   * Ensure #ui-overlay exists and is positioned over canvas.
   * Must be called before any screen is mounted.
   */
  static ensureOverlay(game: Phaser.Game): void {
    let overlay = document.getElementById("ui-overlay");
    if (overlay) {
      DomUI.attachSfxDelegation(game, overlay);
      DomAchievementToast.install(game);
      return;
    }

    overlay = document.createElement("div");
    overlay.id = "ui-overlay";

    const parent = game.canvas.parentElement ?? document.body;
    parent.style.position = "relative";
    parent.appendChild(overlay);

    DomUI.syncOverlayToCanvas(game, overlay);
    DomUI.attachSfxDelegation(game, overlay);
    DomAchievementToast.install(game);
  }

  /** Keep overlay rect aligned with the actual canvas (FIT scale + letterboxing). */
  private static syncOverlayToCanvas(game: Phaser.Game, overlay: HTMLElement): void {
    let rafPending = false;

    const apply = (): void => {
      const canvas = game.canvas;
      if (!canvas) return;
      // Single getBoundingClientRect call instead of 4 separate offsetLeft/Top/Width/Height reads
      const r = canvas.getBoundingClientRect();
      const parentRect = (canvas.parentElement ?? document.body).getBoundingClientRect();
      overlay.style.position = "absolute";
      overlay.style.left = `${r.left - parentRect.left}px`;
      overlay.style.top = `${r.top - parentRect.top}px`;
      overlay.style.width = `${r.width}px`;
      overlay.style.height = `${r.height}px`;
    };

    const scheduleApply = (): void => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        apply();
      });
    };

    apply();
    game.scale.on(Phaser.Scale.Events.RESIZE, scheduleApply);
  }

  private static sfxAttached = false;
  private static attachSfxDelegation(game: Phaser.Game, overlay: HTMLElement): void {
    if (DomUI.sfxAttached) return;
    DomUI.sfxAttached = true;

    const playSfx = (key: string, volume: number, detuneCents: number): void => {
      try {
        if (!game.cache.audio.exists(key)) return;
        const detune = (Math.random() * 2 - 1) * detuneCents;
        const v = Math.max(0, Math.min(1, volume + (Math.random() * 2 - 1) * 0.05));
        game.sound.play(key, { volume: v, detune });
      } catch { /* silent */ }
    };

    overlay.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("button, [role='button'], .btn, .card")) {
        playSfx(AUDIO.sfx.uiClick, 0.55, 200);
      }
    });

    overlay.addEventListener(
      "mouseenter",
      (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.matches?.("button, [role='button'], .btn, .card")) {
          playSfx(AUDIO.sfx.uiHover, 0.3, 250);
        }
      },
      true,
    );
  }

  // ── HUD ───────────────────────────────────────────────────

  mountHUD(game: Phaser.Game, gameEvents: Phaser.Events.EventEmitter, heroId = 0): void {
    DomUI.ensureOverlay(game);
    this.dismountHUD();

    this.hud = new DomHUD();
    this.hud.setHeroId(heroId);
    this.hud.mount(game, gameEvents);

    // Global pause:toggle subscription
    this.pauseGame = game;
    this.onPauseToggle = (active: boolean) => {
      if (active) {
        this.mountPause(game);
      } else {
        this.dismountPause();
      }
    };
    game.events.on("pause:toggle", this.onPauseToggle);

    // Bridge upgrade:offer from game events → upgrade modal.
    // Victory event is handled by PhaseController directly.
    this.hudGameEvents = gameEvents;
    this.onUpgradeOfferBound = (payload: UpgradeOfferPayload) => {
      this.showUpgradeModal(game, gameEvents, payload);
    };
    gameEvents.on(GameEvents.UpgradeOffer, this.onUpgradeOfferBound);

  }

  dismountHUD(): void {
    if (this.hudGameEvents && this.onUpgradeOfferBound) {
      this.hudGameEvents.off(GameEvents.UpgradeOffer, this.onUpgradeOfferBound);
      this.onUpgradeOfferBound = null;
      this.hudGameEvents = null;
    }
    if (this.pauseGame && this.onPauseToggle) {
      this.pauseGame.events.off("pause:toggle", this.onPauseToggle);
      this.onPauseToggle = null;
      this.pauseGame = null;
    }
    this.dismountPause();
    this.hud?.unmount();
    this.hud = null;
    this.dismountUpgradeModal();
  }

  // ── Pause ──────────────────────────────────────────────────

  mountPause(game: Phaser.Game): void {
    if (this.pauseModal) return;
    this.pauseModal = new DomPause(
      () => {
        game.events.emit("pause:toggle", false);
      },
      () => {
        this.dismountPause();
        // Let GameScene handle navigation via its own pause listener
        game.events.emit("pause:menu");
      },
    );
    this.pauseModal.mount();
  }

  dismountPause(): void {
    this.pauseModal?.unmount();
    this.pauseModal = null;
  }

  // ── Menu ──────────────────────────────────────────────────

  mountMenu(game: Phaser.Game, onPlay: () => void): void {
    DomUI.ensureOverlay(game);
    this.dismountMenu();

    this.menu = new DomMenu(onPlay);
    this.menu.mount(game);

    requestAnimationFrame(() => {
      yandex.gameReady();
      window.__splash?.hide();
    });
  }

  dismountMenu(): void {
    this.menu?.unmount();
    this.menu = null;
  }

  // ── GameOver ──────────────────────────────────────────────

  mountGameOver(
    game: Phaser.Game,
    breakdown: RoundBreakdown,
    isDeath: boolean,
    coinsEarned: number,
    onContinue: () => Promise<void>,
    onDoubleCoins: () => Promise<void>,
    onRestart: () => Promise<void>,
    onMenu: () => void,
  ): void {
    DomUI.ensureOverlay(game);
    this.dismountGameOver();

    this.gameOver = new DomGameOver();
    this.gameOver.mount(game, { breakdown, isDeath, coinsEarned, onContinue, onDoubleCoins, onRestart, onMenu });
  }

  dismountGameOver(): void {
    this.gameOver?.unmount();
    this.gameOver = null;
  }

  // ── Upgrade modal ─────────────────────────────────────────

  private showUpgradeModal(
    game: Phaser.Game,
    gameEvents: Phaser.Events.EventEmitter,
    payload: UpgradeOfferPayload,
  ): void {
    if (this.upgradeModal) return;

    // Pause game while choosing.
    game.events.emit("pause:toggle", true);

    const modal = new DomUpgradeModal();
    this.upgradeModal = modal;

    modal.show(
      payload,
      (id: UpgradeId) => {
        // UpgradeApplied is emitted by ProgressionSystem.applyUpgrade internally.
        // We notify PhaseController via game events so it can call cycleReset.
        game.events.emit("upgrade:picked", id);
        gameEvents.emit("upgrade:picked", id);
      },
      () => {
        this.upgradeModal = null;
        game.events.emit("pause:toggle", false);
      },
    );
  }

  dismountUpgradeModal(): void {
    this.upgradeModal?.dismiss();
    this.upgradeModal = null;
  }

  // ── Victory ───────────────────────────────────────────────

  mountVictory(
    game: Phaser.Game,
    stats: VictoryStats,
    onLeaderboard: () => void,
    onMenu: () => void,
  ): void {
    DomUI.ensureOverlay(game);
    this.dismountVictory();

    this.victoryScreen = new DomVictory();
    this.victoryScreen.mount(game, stats, onLeaderboard, onMenu);
  }

  dismountVictory(): void {
    this.victoryScreen?.unmount();
    this.victoryScreen = null;
  }

  // ── Skins modal ───────────────────────────────────────────

  mountSkinsModal(onClose: () => void, game: Phaser.Game | null = null): void {
    if (this.skinsModal) return;
    this.skinsModal = new DomSkinsModal(() => {
      this.skinsModal = null;
      onClose();
    }, game);
    this.skinsModal.mount();
  }

  dismountSkinsModal(): void {
    this.skinsModal?.unmount();
    this.skinsModal = null;
  }

  // ── Settings modal ────────────────────────────────────────

  mountSettingsModal(game: Phaser.Game, onClose: () => void): void {
    if (this.settingsModal) return;
    this.settingsModal = new DomSettingsModal(game, () => {
      this.settingsModal = null;
      onClose();
    });
    this.settingsModal.mount();
  }

  dismountSettingsModal(): void {
    this.settingsModal?.unmount();
    this.settingsModal = null;
  }

  // ── Achievements modal ────────────────────────────────────

  mountAchievementsModal(): void {
    this.dismountAchievementsModal();
    const overlay = document.getElementById("ui-overlay");
    if (!overlay) return;
    const modal = new DomAchievementsModal(() => this.dismountAchievementsModal());
    this.achievementsModalEl = modal.getElement();
    overlay.appendChild(this.achievementsModalEl);
  }

  dismountAchievementsModal(): void {
    this.achievementsModalEl?.remove();
    this.achievementsModalEl = null;
  }

  // ── Leaderboard modal ─────────────────────────────────────

  mountLeaderboardModal(): void {
    if (this.leaderboardModal) return;
    const overlay = document.getElementById("ui-overlay");
    if (!overlay) return;
    this.leaderboardModal = new DomLeaderboardModal(() => {
      this.dismountLeaderboardModal();
    });
    this.leaderboardModal.mount(overlay);
  }

  dismountLeaderboardModal(): void {
    this.leaderboardModal?.unmount();
    this.leaderboardModal = null;
  }

  // ── Tutorial banner ───────────────────────────────────────

  mountTutorial(
    game: Phaser.Game,
    gameEvents: Phaser.Events.EventEmitter,
    getHeroPos: () => { x: number; y: number } | null,
    onComplete: () => void,
  ): void {
    DomUI.ensureOverlay(game);
    this.dismountTutorial();
    this.tutorial = new DomTutorial({
      getHeroPos,
      onComplete: () => {
        this.tutorial = null;
        onComplete();
      },
    });
    this.tutorial.mount(gameEvents);
  }

  dismountTutorial(): void {
    this.tutorial?.unmount();
    this.tutorial = null;
  }

  // ── Daily modal ───────────────────────────────────────────

  mountDailyModal(onClose: () => void, onClaimed: () => void, game: Phaser.Game | null = null): void {
    if (this.dailyModal) return;
    const overlay = document.getElementById("ui-overlay");
    if (!overlay) return;
    this.dailyModal = new DomDailyModal(
      () => {
        this.dismountDailyModal();
        onClose();
      },
      () => {
        onClaimed();
      },
      game,
    );
    this.dailyModal.mount(overlay);
  }

  dismountDailyModal(): void {
    this.dailyModal?.unmount();
    this.dailyModal = null;
  }
}
