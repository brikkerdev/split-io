import { describe, expect, it, vi, beforeEach } from "vitest";
import { Bot } from "@entities/Bot";
import {
  BotAI,
  pickProfile,
  weightsForPlayerPct,
  angleTo,
  wrapAngle,
  steerToward,
} from "./BotAI";

// ---------------------------------------------------------------------------
// Pure function tests (no Phaser)
// ---------------------------------------------------------------------------

describe("pickProfile", () => {
  it("returns aggressor when rand hits aggressor bucket", () => {
    const weights = { aggressor: 1, tourist: 0, hoarder: 0 };
    expect(pickProfile(weights, () => 0)).toBe("aggressor");
  });

  it("returns tourist when rand hits tourist bucket", () => {
    const weights = { aggressor: 0, tourist: 1, hoarder: 0 };
    expect(pickProfile(weights, () => 0)).toBe("tourist");
  });

  it("returns hoarder when aggressor+tourist weight is zero", () => {
    const weights = { aggressor: 0, tourist: 0, hoarder: 1 };
    expect(pickProfile(weights, () => 0)).toBe("hoarder");
  });

  it("distributes correctly by proportion", () => {
    const weights = { aggressor: 1, tourist: 1, hoarder: 1 };
    // rand=0 → aggressor bucket (first)
    expect(pickProfile(weights, () => 0)).toBe("aggressor");
    // rand=0.5 → after 1/3 and 2/3 boundary → tourist
    expect(pickProfile(weights, () => 0.5)).toBe("tourist");
    // rand=0.99 → last bucket → hoarder
    expect(pickProfile(weights, () => 0.99)).toBe("hoarder");
  });
});

describe("weightsForPlayerPct", () => {
  it("returns low aggressor weight at 0%", () => {
    const w = weightsForPlayerPct(0);
    expect(w.aggressor).toBeLessThan(weightsForPlayerPct(50).aggressor);
  });

  it("returns higher aggressor weight at 60%", () => {
    const low = weightsForPlayerPct(0);
    const high = weightsForPlayerPct(60);
    expect(high.aggressor).toBeGreaterThan(low.aggressor);
  });
});

describe("angleTo / wrapAngle / steerToward", () => {
  it("angleTo returns correct angle", () => {
    expect(angleTo(0, 0, 1, 0)).toBeCloseTo(0);
    expect(angleTo(0, 0, 0, 1)).toBeCloseTo(Math.PI / 2);
    expect(angleTo(0, 0, -1, 0)).toBeCloseTo(Math.PI);
  });

  it("wrapAngle stays in [-PI, PI]", () => {
    expect(wrapAngle(Math.PI + 0.1)).toBeLessThan(0);
    expect(Math.abs(wrapAngle(5))).toBeLessThanOrEqual(Math.PI);
  });

  it("steerToward reaches target exactly when within maxDelta", () => {
    expect(steerToward(0, 0.1, 0.5)).toBeCloseTo(0.1);
  });

  it("steerToward clamps to maxDelta when far", () => {
    const result = steerToward(0, Math.PI, 0.1);
    expect(result).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// BotAI integration tests (mocked systems)
// ---------------------------------------------------------------------------

function makeScene(): { events: ReturnType<typeof makeEventEmitter> } {
  return { events: makeEventEmitter() };
}

function makeEventEmitter() {
  type Handler = (...args: unknown[]) => void;
  const listeners = new Map<string, Handler[]>();
  return {
    on(event: string, handler: Handler) {
      const arr = listeners.get(event) ?? [];
      arr.push(handler);
      listeners.set(event, arr);
    },
    off(_event: string) {},
    emit(event: string, ...args: unknown[]) {
      for (const h of listeners.get(event) ?? []) h(...args);
    },
  };
}

function makeGrid() {
  const cells = new Uint16Array(128 * 128);
  return {
    cols: 128,
    rows: 128,
    cellPx: 16,
    worldToCell: (p: { x: number; y: number }) => ({
      cx: Math.floor(p.x / 16),
      cy: Math.floor(p.y / 16),
    }),
    cellToWorld: (c: { cx: number; cy: number }) => ({
      x: c.cx * 16 + 8,
      y: c.cy * 16 + 8,
    }),
    inBounds: (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < 128 && cy < 128,
    ownerOf: (cx: number, cy: number) => cells[cy * 128 + cx] ?? 0,
    setOwner: (cx: number, cy: number, owner: number) => {
      cells[cy * 128 + cx] = owner;
    },
  };
}

function makeTrails() {
  return {
    get: vi.fn().mockReturnValue(undefined),
    appendAndTest: vi.fn(),
    clear: vi.fn(),
    addCellToTrail: vi.fn(),
    checkTrailCollision: vi.fn().mockReturnValue("none"),
    clearTrail: vi.fn(),
  };
}

function makeHero() {
  return { id: 1, pos: { x: 512, y: 512 }, heading: 0, speedCellsPerSec: 7, alive: true };
}

describe("BotAI.spawn", () => {
  let ai: BotAI;

  beforeEach(() => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    ai = new BotAI(
      scene as never,
      grid as never,
      trails as never,
      hero as never,
    );
  });

  it("spawns requested count of bots", () => {
    ai.spawn({
      count: 10,
      passive: false,
      profileWeights: { aggressor: 1, tourist: 1, hoarder: 1 },
    });
    expect(ai.getAll()).toHaveLength(10);
  });

  it("all spawned bots are alive", () => {
    ai.spawn({ count: 5, passive: false, profileWeights: { aggressor: 1, tourist: 1, hoarder: 1 } });
    for (const bot of ai.getAll()) {
      expect(bot.alive).toBe(true);
    }
  });

  it("all spawned bots have valid profiles", () => {
    const validProfiles = new Set(["aggressor", "tourist", "hoarder"]);
    ai.spawn({ count: 15, passive: false, profileWeights: { aggressor: 1, tourist: 1, hoarder: 1 } });
    for (const bot of ai.getAll()) {
      expect(validProfiles.has(bot.profile)).toBe(true);
    }
  });

  it("forces all-aggressor when weights set so", () => {
    ai.spawn({ count: 20, passive: false, profileWeights: { aggressor: 1, tourist: 0, hoarder: 0 } });
    for (const bot of ai.getAll()) {
      expect(bot.profile).toBe("aggressor");
    }
  });

  it("forces all-tourist when weights set so", () => {
    ai.spawn({ count: 10, passive: false, profileWeights: { aggressor: 0, tourist: 1, hoarder: 0 } });
    for (const bot of ai.getAll()) {
      expect(bot.profile).toBe("tourist");
    }
  });

  it("bots start in idle state", () => {
    ai.spawn({ count: 5, passive: false, profileWeights: { aggressor: 1, tourist: 1, hoarder: 1 } });
    for (const bot of ai.getAll()) {
      expect(bot.state).toBe("idle");
    }
  });

  it("bots have unique ids", () => {
    ai.spawn({ count: 15, passive: false, profileWeights: { aggressor: 1, tourist: 1, hoarder: 1 } });
    const ids = ai.getAll().map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("BotAI FSM transitions", () => {
  let ai: BotAI;

  beforeEach(() => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    ai = new BotAI(scene as never, grid as never, trails as never, hero as never);
    ai.spawn({ count: 3, passive: false, profileWeights: { aggressor: 1, tourist: 0, hoarder: 0 } });
  });

  it("transitions idle → leaveHome after idleDuration ticks", () => {
    const bot = ai.getAll()[0] as Bot;
    expect(bot.state).toBe("idle");
    // Force elapsed past threshold.
    bot.stateElapsed = 0;
    // Tick enough to exceed BALANCE.botIdleDurationSec (1.5s).
    ai.update(2);
    expect(bot.state).not.toBe("idle");
  });

  it("bots in passive mode do not transition to returnHome quickly", () => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    const passiveAi = new BotAI(scene as never, grid as never, trails as never, hero as never);
    passiveAi.spawn({ count: 3, passive: true, profileWeights: { aggressor: 1, tourist: 0, hoarder: 0 } });
    for (const bot of passiveAi.getAll()) {
      bot.stateElapsed = 0;
    }
    passiveAi.update(0.016);
    for (const bot of passiveAi.getAll()) {
      expect(bot.state).not.toBe("returnHome");
    }
  });

  it("destroy clears all bots", () => {
    ai.destroy();
    expect(ai.getAll()).toHaveLength(0);
  });
});

describe("BotAI trail behaviour", () => {
  it("calls addCellToTrail when bot moves outside own territory", () => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    const ai = new BotAI(scene as never, grid as never, trails as never, hero as never);
    ai.spawn({ count: 1, passive: false, profileWeights: { aggressor: 0, tourist: 1, hoarder: 0 } });

    const bot = ai.getAll()[0] as Bot;
    // Move bot to a position not owned by it so moveBot enters trail branch.
    bot.pos = { x: 8, y: 8 }; // cell (0,0) owned by nobody
    bot.state = "leaveHome";
    bot.stateElapsed = 10;
    ai.update(0.016);
    expect(trails.addCellToTrail).toHaveBeenCalled();
  });

  it("calls checkTrailCollision when bot is outside own territory", () => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    const ai = new BotAI(scene as never, grid as never, trails as never, hero as never);
    ai.spawn({ count: 1, passive: false, profileWeights: { aggressor: 0, tourist: 1, hoarder: 0 } });

    const bot = ai.getAll()[0] as Bot;
    bot.pos = { x: 8, y: 8 }; // cell (0,0) owned by nobody
    bot.state = "leaveHome";
    bot.stateElapsed = 10;
    ai.update(0.016);
    expect(trails.checkTrailCollision).toHaveBeenCalled();
  });

  it("returnHome state steers bot toward home", () => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    const ai = new BotAI(scene as never, grid as never, trails as never, hero as never);
    ai.spawn({ count: 1, passive: false, profileWeights: { aggressor: 0, tourist: 1, hoarder: 0 } });

    const bot = ai.getAll()[0] as Bot;
    bot.state = "returnHome";
    bot.stateElapsed = 0;
    // Position bot far from home.
    bot.pos = { x: bot.pos.x + 200, y: bot.pos.y + 200 };
    const headingBefore = bot.heading;
    ai.update(0.1);
    // Heading should have changed toward home.
    expect(bot.heading).not.toBeCloseTo(headingBefore, 5);
  });

  it("dead bots do not call addCellToTrail", () => {
    const scene = makeScene();
    const grid = makeGrid();
    const trails = makeTrails();
    const hero = makeHero();
    const ai = new BotAI(scene as never, grid as never, trails as never, hero as never);
    ai.spawn({ count: 1, passive: false, profileWeights: { aggressor: 0, tourist: 1, hoarder: 0 } });

    const bot = ai.getAll()[0] as Bot;
    bot.alive = false;
    bot.state = "leaveHome";
    ai.update(0.016);
    expect(trails.addCellToTrail).not.toHaveBeenCalled();
  });
});
