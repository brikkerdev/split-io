import { SCORE } from "@config/score";
import { yandex } from "@sdk/yandex";

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
}

const LS_KEY = "lb_mock";
const MOCK_PLAYER_ID = "__player__";

function mockEntries(): LeaderboardEntry[] {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as LeaderboardEntry[];
}

function saveMockEntries(entries: LeaderboardEntry[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

function upsertMock(score: number): void {
  const entries = mockEntries().filter((e) => e.name !== MOCK_PLAYER_ID);
  entries.push({ rank: 0, name: MOCK_PLAYER_ID, score });
  entries.sort((a, b) => b.score - a.score);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });
  saveMockEntries(entries);
}

export class LeaderboardSystem {
  private lastSubmitted = 0;

  async submitScore(score: number): Promise<void> {
    if (score <= this.lastSubmitted) return;
    this.lastSubmitted = score;

    if (yandex.isMock) {
      upsertMock(score);
      return;
    }

    await yandex.setLeaderboardScore(SCORE.leaderboardName, score);
  }

  async getTop(n = 10): Promise<LeaderboardEntry[]> {
    if (yandex.isMock) {
      return mockEntries().slice(0, n);
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
      const entries = mockEntries();
      const idx = entries.findIndex((e) => e.name === MOCK_PLAYER_ID);
      return idx === -1 ? -1 : entries[idx]!.rank;
    }

    const response = await yandex.getLeaderboardEntries(SCORE.leaderboardName, 1, true);
    if (!response?.userEntry) return -1;
    return response.userEntry.rank;
  }
}
