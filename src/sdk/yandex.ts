import type Phaser from "phaser";
import { ADS_INTERSTITIAL_COOLDOWN_MS, DEFAULT_LANG, type Lang, SUPPORTED_LANGS } from "@config/game";

const DEBUG = false;
import type { YsdkLeaderboardResponse, YsdkRoot } from "./types";

declare global {
  interface Window {
    YaGames?: { init(): Promise<YsdkRoot> };
  }
}

class YandexSDK {
  private ysdk: YsdkRoot | null = null;
  private player: Awaited<ReturnType<YsdkRoot["getPlayer"]>> | null = null;
  private lastInterstitialAt = 0;
  private ready = false;
  private bannerShown = false;
  private game: Phaser.Game | null = null;

  setGame(game: Phaser.Game): void {
    this.game = game;
  }

  get isMock(): boolean {
    return this.ysdk === null;
  }

  async init(): Promise<void> {
    if (typeof window.YaGames === "undefined") {
      if (DEBUG) console.warn("[yandex] SDK not loaded — running in mock mode");
      return;
    }
    try {
      this.ysdk = await window.YaGames.init();
      this.player = await this.ysdk.getPlayer({ scopes: false }).catch(() => null);
    } catch (err) {
      console.error("[yandex] init failed, fallback to mock:", err);
      this.ysdk = null;
    }
  }

  gameReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.ysdk?.features.LoadingAPI?.ready();
  }

  gameplayStart(): void {
    this.ysdk?.features.GameplayAPI?.start();
  }

  gameplayStop(): void {
    this.ysdk?.features.GameplayAPI?.stop();
  }

  getLang(): Lang {
    // Priority: SDK i18n (canonical on Yandex Games) → URL ?lang= → default.
    // We must read ysdk.environment.i18n.lang first so Yandex's automated
    // i18n quality check sees the property access at runtime; otherwise the
    // ?lang= URL param (which Yandex always sets) short-circuits the read
    // and the validator reports the game as not using i18n.
    const fromSdk = this.ysdk?.environment.i18n.lang;
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    const raw = fromSdk ?? fromUrl ?? DEFAULT_LANG;
    return (SUPPORTED_LANGS as readonly string[]).includes(raw) ? (raw as Lang) : DEFAULT_LANG;
  }

  private adOpen(): () => void {
    const preMute = this.game?.sound.mute ?? false;
    if (this.game) {
      this.game.sound.mute = true;
      this.game.events.emit("pause:toggle", true);
    }
    return () => {
      if (this.game) {
        this.game.sound.mute = preMute;
        this.game.events.emit("pause:toggle", false);
      }
    };
  }

  async showInterstitial(): Promise<void> {
    const now = Date.now();
    if (now - this.lastInterstitialAt < ADS_INTERSTITIAL_COOLDOWN_MS) return;
    this.lastInterstitialAt = now;

    if (!this.ysdk) {
      if (DEBUG) console.log("[yandex:mock] interstitial");
      const restore = this.adOpen();
      await new Promise((r) => setTimeout(r, 500));
      restore();
      return;
    }
    await new Promise<void>((resolve) => {
      let restore: (() => void) | null = null;
      const done = () => {
        restore?.();
        resolve();
      };
      this.ysdk?.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => { restore = this.adOpen(); },
          onClose: () => done(),
          onError: () => done(),
        },
      });
    });
  }

  async showRewarded(): Promise<boolean> {
    if (!this.ysdk) {
      if (DEBUG) console.log("[yandex:mock] rewarded → granted");
      const restore = this.adOpen();
      await new Promise((r) => setTimeout(r, 500));
      restore();
      return true;
    }
    return new Promise<boolean>((resolve) => {
      let rewarded = false;
      let settled = false;
      let restore: (() => void) | null = null;
      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        restore?.();
        resolve(result);
      };
      // Yandex sometimes fires onClose before onRewarded — defer settling on close
      // so the reward callback can flip the flag first.
      const settleAfterClose = () => {
        setTimeout(() => settle(rewarded), 150);
      };
      this.ysdk?.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => { restore = this.adOpen(); },
          onRewarded: () => {
            rewarded = true;
          },
          onClose: () => settleAfterClose(),
          onError: () => settle(false),
        },
      });
    });
  }

  async showBanner(): Promise<void> {
    if (this.bannerShown) return;
    this.bannerShown = true;
    if (!this.ysdk) {
      if (DEBUG) console.log("[yandex:mock] showBanner");
      return;
    }
    this.ysdk.adv.showBannerAdv();
  }

  async hideBanner(): Promise<void> {
    if (!this.ysdk) {
      if (DEBUG) console.log("[yandex:mock] hideBanner");
      return;
    }
    this.ysdk.adv.hideBannerAdv();
  }

  async maybeShowShortcutPrompt(): Promise<void> {
    if (!this.ysdk?.shortcut) return;
    try {
      const { canShow } = await this.ysdk.shortcut.canShowPrompt();
      if (canShow) {
        await this.ysdk.shortcut.showPrompt();
      }
    } catch {
      // silent — shortcut prompt is optional
    }
  }

  async save<T>(data: T): Promise<void> {
    queueMicrotask(() => {
      const json = JSON.stringify(data);
      localStorage.setItem("save", json);
    });
    if (this.player) {
      try {
        await this.player.setData(data as Record<string, unknown>, true);
      } catch (err) {
        console.warn("[yandex] cloud save failed:", err);
      }
    }
  }

  async load<T>(): Promise<T | null> {
    if (this.player) {
      try {
        const data = await this.player.getData();
        if (data && Object.keys(data).length > 0) return data as T;
      } catch (err) {
        console.warn("[yandex] cloud load failed:", err);
      }
    }
    const local = localStorage.getItem("save");
    return local ? (JSON.parse(local) as T) : null;
  }

  /**
   * True when a Yandex player session is authenticated (not "lite").
   * Lite players cannot post to leaderboards.
   */
  isAuthorized(): boolean {
    if (!this.ysdk || !this.player) return false;
    const mode = this.player.getMode?.();
    if (mode === undefined) return true;
    return mode !== "lite";
  }

  /**
   * Prompt the Yandex auth dialog. Resolves with true if the player is
   * authorized after the dialog closes. Safe to call in mock mode (no-op
   * → false).
   */
  async requestAuth(): Promise<boolean> {
    if (!this.ysdk) return false;
    try {
      await this.ysdk.auth.openAuthDialog();
      this.player = await this.ysdk.getPlayer({ scopes: false }).catch(() => null);
      return this.isAuthorized();
    } catch {
      return false;
    }
  }

  async setLeaderboardScore(name: string, score: number): Promise<void> {
    if (!this.ysdk) {
      if (DEBUG) console.log(`[yandex:mock] leaderboard ${name} = ${score}`);
      return;
    }
    try {
      const lb = await this.ysdk.getLeaderboards();
      await lb.setLeaderboardScore(name, score);
    } catch (err) {
      console.warn("[yandex] leaderboard failed:", err);
    }
  }

  async getLeaderboardEntries(
    name: string,
    quantityTop = 10,
    includeUser = true,
    quantityAround = 0,
  ): Promise<YsdkLeaderboardResponse | null> {
    if (!this.ysdk) return null;
    try {
      const lb = await this.ysdk.getLeaderboards();
      return await lb.getLeaderboardEntries(name, { quantityTop, includeUser, quantityAround });
    } catch (err) {
      console.warn("[yandex] leaderboard fetch failed:", err);
      return null;
    }
  }
}

export const yandex = new YandexSDK();
