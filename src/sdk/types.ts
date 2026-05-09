export interface YsdkRoot {
  environment: {
    i18n: { lang: string };
    app: { id: string };
  };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  adv: {
    showFullscreenAdv(opts: {
      callbacks: { onClose?(): void; onError?(err: unknown): void; onOpen?(): void };
    }): void;
    showRewardedVideo(opts: {
      callbacks: {
        onRewarded?(): void;
        onClose?(): void;
        onError?(err: unknown): void;
        onOpen?(): void;
      };
    }): void;
    showBannerAdv(): void;
    hideBannerAdv(): void;
    getBannerAdvStatus(): { stickyAdvIsShowing: boolean; reason?: string };
  };
  shortcut?: {
    canShowPrompt(): Promise<{ canShow: boolean }>;
    showPrompt(): Promise<{ outcome: "accepted" | "rejected" }>;
  };
  getPlayer(opts: { scopes: boolean }): Promise<YsdkPlayer>;
  getLeaderboards(): Promise<YsdkLeaderboards>;
  auth: {
    openAuthDialog(): Promise<void>;
  };
}

export interface YsdkPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
  getStats(keys?: string[]): Promise<Record<string, number>>;
  setStats(stats: Record<string, number>): Promise<void>;
  incrementStats(stats: Record<string, number>): Promise<Record<string, number>>;
  getMode?(): "lite" | "";
  getUniqueID?(): string;
  getName?(): string;
}

export interface YsdkLeaderboardEntry {
  score: number;
  rank: number;
  player: {
    publicName: string;
    uniqueID: string;
  };
  extraData?: string;
}

export interface YsdkLeaderboardResponse {
  entries: YsdkLeaderboardEntry[];
  userEntry?: YsdkLeaderboardEntry;
}

export interface YsdkLeaderboards {
  setLeaderboardScore(name: string, score: number, extra?: string): Promise<void>;
  getLeaderboardEntries(
    name: string,
    opts?: { quantityTop?: number; includeUser?: boolean },
  ): Promise<YsdkLeaderboardResponse>;
}
