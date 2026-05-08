import { ADS_INTERSTITIAL_COOLDOWN_MS, DEFAULT_LANG, type Lang, SUPPORTED_LANGS } from "@config/game";
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

  get isMock(): boolean {
    return this.ysdk === null;
  }

  async init(): Promise<void> {
    if (typeof window.YaGames === "undefined") {
      console.warn("[yandex] SDK not loaded — running in mock mode");
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
    const raw = this.ysdk?.environment.i18n.lang ?? navigator.language.slice(0, 2);
    return (SUPPORTED_LANGS as readonly string[]).includes(raw) ? (raw as Lang) : DEFAULT_LANG;
  }

  async showInterstitial(): Promise<void> {
    const now = Date.now();
    if (now - this.lastInterstitialAt < ADS_INTERSTITIAL_COOLDOWN_MS) return;
    this.lastInterstitialAt = now;

    if (!this.ysdk) {
      console.log("[yandex:mock] interstitial");
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
    await new Promise<void>((resolve) => {
      this.ysdk?.adv.showFullscreenAdv({
        callbacks: {
          onClose: () => resolve(),
          onError: () => resolve(),
        },
      });
    });
  }

  async showRewarded(): Promise<boolean> {
    if (!this.ysdk) {
      console.log("[yandex:mock] rewarded → granted");
      await new Promise((r) => setTimeout(r, 500));
      return true;
    }
    return new Promise<boolean>((resolve) => {
      let rewarded = false;
      this.ysdk?.adv.showRewardedVideo({
        callbacks: {
          onRewarded: () => {
            rewarded = true;
          },
          onClose: () => resolve(rewarded),
          onError: () => resolve(false),
        },
      });
    });
  }

  async save<T>(data: T): Promise<void> {
    const json = JSON.stringify(data);
    localStorage.setItem("save", json);
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

  async setLeaderboardScore(name: string, score: number): Promise<void> {
    if (!this.ysdk) {
      console.log(`[yandex:mock] leaderboard ${name} = ${score}`);
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
  ): Promise<YsdkLeaderboardResponse | null> {
    if (!this.ysdk) return null;
    try {
      const lb = await this.ysdk.getLeaderboards();
      return await lb.getLeaderboardEntries(name, { quantityTop, includeUser });
    } catch (err) {
      console.warn("[yandex] leaderboard fetch failed:", err);
      return null;
    }
  }
}

export const yandex = new YandexSDK();
