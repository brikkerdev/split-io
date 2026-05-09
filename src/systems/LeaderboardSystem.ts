import { SCORE } from "@config/score";
import { yandex } from "@sdk/yandex";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

const LS_KEY = "lb_mock";
const MOCK_PLAYER_ID = "__player__";

export class LeaderboardSystem {
  private lastSubmitted = 0;
  private mockCache: LeaderboardEntry[] | null = null;
  private dirty = false;
  private flushScheduled = false;

  private getMockEntries(): LeaderboardEntry[] {
    if (this.mockCache !== null) return this.mockCache;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      this.mockCache = [];
      return this.mockCache;
    }
    const parsed: unknown = JSON.parse(raw);
    this.mockCache = Array.isArray(parsed) ? (parsed as LeaderboardEntry[]) : [];
    return this.mockCache;
  }

  private scheduleMockFlush(): void {
    if (this.flushScheduled) return;
    // Use a microtask so multiple upserts in the same tick are batched,
    // but localStorage is written before the next awaited expression in callers.
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flushMock();
    });
  }

  private flushMock(): void {
    if (!this.dirty || this.mockCache === null) return;
    this.dirty = false;
    localStorage.setItem(LS_KEY, JSON.stringify(this.mockCache));
  }

  private upsertMock(score: number): void {
    const entries = this.getMockEntries().filter((e) => e.name !== MOCK_PLAYER_ID);
    entries.push({ rank: 0, name: MOCK_PLAYER_ID, score });
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((e, i) => {
      e.rank = i + 1;
    });
    this.mockCache = entries;
    this.dirty = true;
    this.scheduleMockFlush();
  }

  /** True if the user previously consented to publishing scores.
   *  Returns null when the save is not yet loaded (unknown). */
  private loadedConsent(): boolean | null {
    let save: SaveV1 | null = null;
    try { save = saves.get<SaveV1>(); } catch { return null; /* not loaded */ }
    return save?.lbConsent === true;
  }

  /** True if the user previously consented to publishing scores. */
  hasConsent(): boolean {
    return this.loadedConsent() === true;
  }

  /** True when consent + Yandex auth are both in place — score can be sent now.
   *  When the save is not loaded we cannot verify consent, so we proceed. */
  canSubmit(): boolean {
    if (yandex.isMock) return true;
    const consent = this.loadedConsent();
    if (consent === null) return true; // save not loaded — assume allowed
    return consent && yandex.isAuthorized();
  }

  /** Returns the largest score currently waiting for consent + auth, if any. */
  getPendingScore(): number {
    let save: SaveV1 | null = null;
    try { save = saves.get<SaveV1>(); } catch { /* not loaded */ }
    return save?.pendingLbScore ?? 0;
  }

  /**
   * Try to submit. If consent or auth is missing on a real Yandex session, the
   * score is parked in the save (`pendingLbScore`) and nothing is sent. The
   * leaderboard modal flushes the pending score after the user consents.
   */
  async submitScore(score: number): Promise<void> {
    if (score <= this.lastSubmitted) return;

    if (yandex.isMock) {
      this.lastSubmitted = score;
      this.upsertMock(score);
      return;
    }

    if (!this.canSubmit()) {
      const prev = this.getPendingScore();
      if (score > prev) {
        try { saves.patch({ pendingLbScore: score }); } catch { /* not loaded */ }
      }
      return;
    }

    this.lastSubmitted = score;
    await yandex.setLeaderboardScore(SCORE.leaderboardName, score);
    try { saves.patch({ pendingLbScore: 0 }); } catch { /* not loaded */ }
  }

  /**
   * Mark consent and flush any score that was parked while waiting. Triggers
   * the auth dialog if the player is not yet authorized.
   * Returns true on successful submission (or no-op when nothing was pending).
   */
  async grantConsentAndFlush(): Promise<boolean> {
    try { saves.patch({ lbConsent: true }); } catch { /* not loaded */ }

    if (yandex.isMock) {
      const pending = this.getPendingScore();
      if (pending > 0) {
        this.upsertMock(pending);
        try { saves.patch({ pendingLbScore: 0 }); } catch { /* not loaded */ }
      }
      return true;
    }

    if (!yandex.isAuthorized()) {
      const ok = await yandex.requestAuth();
      if (!ok) return false;
    }

    const pending = this.getPendingScore();
    if (pending > 0) {
      this.lastSubmitted = pending;
      await yandex.setLeaderboardScore(SCORE.leaderboardName, pending);
      try { saves.patch({ pendingLbScore: 0 }); } catch { /* not loaded */ }
    }
    return true;
  }

  async getTop(n = 10): Promise<LeaderboardEntry[]> {
    if (yandex.isMock) {
      return this.getMockEntries().slice(0, n);
    }

    const response = await yandex.getLeaderboardEntries(SCORE.leaderboardName, n, false);
    if (!response) return [];

    return response.entries.map((e) => ({
      rank: e.rank,
      name: e.player.publicName,
      score: e.score,
    }));
  }

  async getPlayerRank(): Promise<number> {
    if (yandex.isMock) {
      const entries = this.getMockEntries();
      const idx = entries.findIndex((e) => e.name === MOCK_PLAYER_ID);
      return idx === -1 ? -1 : entries[idx]!.rank;
    }

    const response = await yandex.getLeaderboardEntries(SCORE.leaderboardName, 1, true);
    if (!response?.userEntry) return -1;
    return response.userEntry.rank;
  }
}
