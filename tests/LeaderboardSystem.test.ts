import { describe, it, expect, vi, beforeEach } from "vitest";

let mockMode = true; // toggles isMock

const mockLbResponse = {
  entries: [
    { rank: 1, score: 9000, player: { publicName: "Alice", uniqueID: "a1" } },
    { rank: 2, score: 7500, player: { publicName: "Bob", uniqueID: "b2" } },
  ],
  userEntry: { rank: 3, score: 6000, player: { publicName: "You", uniqueID: "u3" } },
};

vi.mock("@sdk/yandex", () => ({
  yandex: {
    get isMock() {
      return mockMode;
    },
    setLeaderboardScore: vi.fn(async () => undefined),
    getLeaderboardEntries: vi.fn(async () => mockLbResponse),
  },
}));

vi.mock("@config/score", () => ({
  SCORE: {
    leaderboardName: "score_round",
  },
}));

// Provide localStorage shim (jsdom supplies it, but let's be safe with a map).
const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => {
    lsStore[k] = v;
  },
  removeItem: (k: string) => {
    delete lsStore[k];
  },
});

import { LeaderboardSystem } from "../src/systems/LeaderboardSystem";
import { yandex } from "../src/sdk/yandex";

describe("LeaderboardSystem — mock / fallback", () => {
  let lb: LeaderboardSystem;

  beforeEach(() => {
    mockMode = true;
    delete lsStore["lb_mock"];
    lb = new LeaderboardSystem();
    vi.clearAllMocks();
  });

  it("submitScore stores in localStorage on mock", async () => {
    await lb.submitScore(5000);
    const stored = JSON.parse(lsStore["lb_mock"] ?? "[]") as { score: number }[];
    expect(stored[0]?.score).toBe(5000);
  });

  it("submitScore does not re-submit lower score", async () => {
    await lb.submitScore(5000);
    await lb.submitScore(3000); // lower, skip
    const stored = JSON.parse(lsStore["lb_mock"] ?? "[]") as { score: number }[];
    expect(stored).toHaveLength(1);
  });

  it("getTop returns sorted local entries", async () => {
    await lb.submitScore(5000);
    const top = await lb.getTop(10);
    expect(top).toHaveLength(1);
    expect(top[0]?.score).toBe(5000);
  });

  it("getTop limits result to n", async () => {
    await lb.submitScore(5000);
    const top = await lb.getTop(0);
    expect(top).toHaveLength(0);
  });

  it("getPlayerRank returns -1 when no score submitted", async () => {
    const rank = await lb.getPlayerRank();
    expect(rank).toBe(-1);
  });

  it("getPlayerRank returns 1 after single submit", async () => {
    await lb.submitScore(5000);
    const rank = await lb.getPlayerRank();
    expect(rank).toBe(1);
  });
});

describe("LeaderboardSystem — Yandex SDK", () => {
  let lb: LeaderboardSystem;

  beforeEach(() => {
    mockMode = false;
    lb = new LeaderboardSystem();
    vi.clearAllMocks();
  });

  it("submitScore calls yandex.setLeaderboardScore", async () => {
    await lb.submitScore(8000);
    expect(yandex.setLeaderboardScore).toHaveBeenCalledWith("score_round", 8000);
  });

  it("getTop maps SDK response to LeaderboardEntry[]", async () => {
    const top = await lb.getTop(10);
    expect(top).toHaveLength(2);
    expect(top[0]).toEqual({ rank: 1, name: "Alice", score: 9000 });
  });

  it("getPlayerRank returns userEntry.rank from SDK", async () => {
    const rank = await lb.getPlayerRank();
    expect(rank).toBe(3);
  });

  it("getTop returns [] when SDK returns null", async () => {
    vi.mocked(yandex.getLeaderboardEntries).mockResolvedValueOnce(null as never);
    const top = await lb.getTop();
    expect(top).toEqual([]);
  });

  it("getPlayerRank returns -1 when SDK returns null", async () => {
    vi.mocked(yandex.getLeaderboardEntries).mockResolvedValueOnce(null as never);
    const rank = await lb.getPlayerRank();
    expect(rank).toBe(-1);
  });
});
