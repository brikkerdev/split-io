import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSaveData: Record<string, unknown> = {
  version: 1,
  coins: 0,
  achievements: {} as Record<string, number>,
};

vi.mock("@systems/SaveManager", () => ({
  saves: {
    get: vi.fn(() => mockSaveData),
    patch: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(mockSaveData, partial);
    }),
  },
}));

vi.mock("@config/achievements", () => ({
  ACHIEVEMENTS: {
    list: [
      { id: "first_5pct",      nameKey: "ach.first_5pct",      target: 1,  rewardCoins: 50  },
      { id: "capture_50pct",   nameKey: "ach.capture_50pct",   target: 1,  rewardCoins: 150 },
      { id: "capture_100pct",  nameKey: "ach.capture_100pct",  target: 1,  rewardCoins: 500 },
      { id: "survive_round",   nameKey: "ach.survive_round",   target: 1,  rewardCoins: 100 },
      { id: "kill_with_ghost", nameKey: "ach.kill_with_ghost", target: 1,  rewardCoins: 100 },
      { id: "ten_kills_round", nameKey: "ach.ten_kills_round", target: 10, rewardCoins: 200 },
      { id: "top1_streak3",    nameKey: "ach.top1_streak3",    target: 3,  rewardCoins: 300 },
      { id: "all_skins",       nameKey: "ach.all_skins",       target: 12, rewardCoins: 1000 },
    ],
  },
}));

// Fake Phaser scene with event emitter
function makeScene(): { events: ReturnType<typeof makeEmitter>; game: { events: ReturnType<typeof makeEmitter> } } {
  return {
    events: makeEmitter(),
    game: { events: makeEmitter() },
  };
}

function makeEmitter() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(fn);
    }),
    off: vi.fn(),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      handlers.get(event)?.forEach((fn) => fn(...args));
    }),
    handlers,
  };
}

import { AchievementSystem } from "../src/systems/AchievementSystem";
import { saves } from "../src/systems/SaveManager";

const HERO_ID = 42;

function makeSystem(scene = makeScene()) {
  // AchievementSystem constructor calls scene.events.on — we use our fake emitter
  const sys = new AchievementSystem(
    scene as unknown as Phaser.Scene,
    HERO_ID,
  );
  sys.resetRound();
  return { sys, scene };
}

// Helper: fire a scene event directly
function fireSceneEvent(scene: ReturnType<typeof makeScene>, event: string, payload: unknown) {
  scene.events.emit(event, payload);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AchievementSystem — territory unlocks", () => {
  beforeEach(() => {
    mockSaveData.coins = 0;
    mockSaveData.achievements = {};
    vi.clearAllMocks();
  });

  it("unlocks first_5pct when territory >= 5", () => {
    const { sys, scene } = makeSystem();
    void sys; // ensure constructed

    fireSceneEvent(scene, "territory:update", { owner: HERO_ID, percent: 5 });

    expect(saves.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ first_5pct: expect.any(Number) }),
      }),
    );
  });

  it("does not unlock first_5pct when territory < 5", () => {
    const { sys, scene } = makeSystem();
    void sys;

    fireSceneEvent(scene, "territory:update", { owner: HERO_ID, percent: 4.9 });

    expect(saves.patch).not.toHaveBeenCalled();
  });

  it("is idempotent — second trigger does not re-patch", () => {
    const { sys, scene } = makeSystem();
    void sys;

    fireSceneEvent(scene, "territory:update", { owner: HERO_ID, percent: 5 });
    // Simulate save already has this achievement
    (mockSaveData.achievements as Record<string, number>)["first_5pct"] = Date.now();
    vi.clearAllMocks();

    fireSceneEvent(scene, "territory:update", { owner: HERO_ID, percent: 10 });

    expect(saves.patch).not.toHaveBeenCalled();
  });

  it("ignores territory updates from other owners", () => {
    const { sys, scene } = makeSystem();
    void sys;

    fireSceneEvent(scene, "territory:update", { owner: HERO_ID + 1, percent: 99 });

    expect(saves.patch).not.toHaveBeenCalled();
  });
});

describe("AchievementSystem — kill tracking", () => {
  beforeEach(() => {
    mockSaveData.coins = 0;
    mockSaveData.achievements = {};
    vi.clearAllMocks();
  });

  it("unlocks kill_with_ghost when ghost is active during kill", () => {
    const { sys, scene } = makeSystem();
    void sys;

    // Spawn ghost → mark active
    fireSceneEvent(scene, "ghost:spawned", {});
    // Cut trail while ghost active
    fireSceneEvent(scene, "trail:cut", { killer: HERO_ID, victim: 99 });

    expect(saves.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ kill_with_ghost: expect.any(Number) }),
      }),
    );
  });

  it("does not unlock kill_with_ghost when ghost is inactive", () => {
    const { sys, scene } = makeSystem();
    void sys;

    fireSceneEvent(scene, "trail:cut", { killer: HERO_ID, victim: 99 });

    expect(saves.patch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ kill_with_ghost: expect.anything() }),
      }),
    );
  });

  it("unlocks ten_kills_round after 10 kills", () => {
    const { sys, scene } = makeSystem();
    void sys;

    for (let i = 0; i < 10; i++) {
      fireSceneEvent(scene, "trail:cut", { killer: HERO_ID, victim: i });
    }

    const patchCalls = vi.mocked(saves.patch).mock.calls;
    const lastCall = patchCalls[patchCalls.length - 1]?.[0] as Record<string, unknown> | undefined;
    expect((lastCall?.achievements as Record<string, unknown> | undefined)?.ten_kills_round).toBeDefined();
  });
});

describe("AchievementSystem — round end / streak", () => {
  beforeEach(() => {
    mockSaveData.coins = 0;
    mockSaveData.achievements = {};
    vi.clearAllMocks();
  });

  it("unlocks survive_round when elapsed >= 60s", () => {
    const { sys, scene } = makeSystem();
    // Override start time to 61 seconds ago
    (sys as unknown as { roundStartMs: number }).roundStartMs = Date.now() - 61_000;

    fireSceneEvent(scene, "round:end", {
      territoryPct: 10, territoryPoints: 100, secondsBonus: 61, kills: 0,
      killPoints: 0, penalty: 0, total: 161, rank: 2, bestNew: false,
    });

    expect(saves.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ survive_round: expect.any(Number) }),
      }),
    );
  });

  it("does not unlock survive_round when elapsed < 60s", () => {
    const { sys, scene } = makeSystem();
    (sys as unknown as { roundStartMs: number }).roundStartMs = Date.now() - 10_000;

    fireSceneEvent(scene, "round:end", {
      territoryPct: 5, territoryPoints: 50, secondsBonus: 10, kills: 0,
      killPoints: 0, penalty: 0, total: 60, rank: 3, bestNew: false,
    });

    expect(saves.patch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ survive_round: expect.anything() }),
      }),
    );
  });

  it("unlocks top1_streak3 after three consecutive rank-1 finishes", () => {
    const { sys, scene } = makeSystem();
    void sys;

    const roundEnd = (rank: number) =>
      fireSceneEvent(scene, "round:end", {
        territoryPct: 50, territoryPoints: 500, secondsBonus: 100, kills: 0,
        killPoints: 0, penalty: 0, total: 600, rank, bestNew: false,
      });

    roundEnd(1);
    roundEnd(1);
    // Clear intermediate patches so we can isolate the third
    vi.clearAllMocks();
    (mockSaveData.achievements as Record<string, number>)["top1_streak3"] = 0; // ensure not prematurely set
    delete (mockSaveData.achievements as Record<string, number>)["top1_streak3"];

    roundEnd(1);

    expect(saves.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ top1_streak3: expect.any(Number) }),
      }),
    );
  });

  it("resets streak after non-rank-1 finish", () => {
    const { sys, scene } = makeSystem();
    void sys;

    const roundEnd = (rank: number) =>
      fireSceneEvent(scene, "round:end", {
        territoryPct: 50, territoryPoints: 500, secondsBonus: 100, kills: 0,
        killPoints: 0, penalty: 0, total: 600, rank, bestNew: false,
      });

    roundEnd(1);
    roundEnd(2); // breaks streak
    vi.clearAllMocks();
    roundEnd(1);
    roundEnd(1);
    // Still only 2 consecutive rank-1s — should not unlock
    expect(saves.patch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        achievements: expect.objectContaining({ top1_streak3: expect.anything() }),
      }),
    );
  });
});
