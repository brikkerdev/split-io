import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotAI } from "../src/systems/BotAI";
import { BOTS } from "../src/config/bots";
import type { Bot } from "../src/entities/Bot";

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeScene() {
  type Handler = (...args: unknown[]) => void;
  const listeners = new Map<string, Handler[]>();
  return {
    events: {
      on(event: string, handler: Handler) {
        const arr = listeners.get(event) ?? [];
        arr.push(handler);
        listeners.set(event, arr);
      },
      off() {},
      emit(event: string, ...args: unknown[]) {
        for (const h of listeners.get(event) ?? []) h(...args);
      },
    },
    time: {
      delayedCall(_delay: number, cb: () => void) { cb(); },
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
  const activeTrail = {
    active: true,
    polylineLength: () => 4,
    appendPoint: vi.fn(),
    getPolyline: () => [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 12, y: 0 },
    ],
  };
  return {
    _activeTrail: activeTrail,
    get: vi.fn().mockReturnValue(activeTrail),
    ensure: vi.fn().mockReturnValue(activeTrail),
    appendAndTest: vi.fn().mockReturnValue("none"),
    addPoint: vi.fn(),
    checkTrailCollision: vi.fn((): "none" | "closed" | "cut" => "none"),
    clearTrail: vi.fn(),
    setPeerGroup: vi.fn(),
    removeUnit: vi.fn(),
  };
}

function makeTerritory() {
  return {
    // Always 0 so bots count as "outside own territory" — eligible to fire.
    ownerAt: (_x: number, _y: number): number => 0,
    isOwnedBy: (_x: number, _y: number, _owner: number): boolean => false,
    claim: vi.fn(),
    release: vi.fn(),
    shrink: vi.fn(),
    getOwnerPercent: vi.fn().mockReturnValue(0),
    getNearestOwnerPoint: vi.fn().mockReturnValue({ x: 0, y: 0 }),
  };
}

function makeHero(x = 512, y = 512) {
  return { id: 1, pos: { x, y }, heading: 0, speedCellsPerSec: 7, alive: true };
}

// ---------------------------------------------------------------------------

describe("BotAI ghosts", () => {
  let ai: BotAI;
  let trails: ReturnType<typeof makeTrails>;

  function spawnOneBot(): Bot {
    ai.spawn({
      count: 1,
      passive: false,
      profileWeights: { aggressor: 1, tourist: 0, hoarder: 0 },
    });
    return ai.getAll()[0] as Bot;
  }

  beforeEach(() => {
    const scene = makeScene();
    const grid = makeGrid();
    trails = makeTrails();
    const hero = makeHero();
    const territory = makeTerritory();
    ai = new BotAI(scene as never, grid as never, trails as never, hero as never, territory as never);
  });

  it("does not spawn a ghost when bot's trail is inactive", () => {
    const bot = spawnOneBot();
    bot.trailLen = BOTS.ghost.minTrailLenCells + 5;
    // Force inactive trail.
    trails._activeTrail.active = false;
    bot.pos = { x: 100, y: 100 };

    ai.update(BOTS.ghost.cooldownSec * 2);

    expect(ai.getActiveGhosts()).toHaveLength(0);
  });

  it("spawns a ghost when conditions are met and cooldown elapsed", () => {
    const bot = spawnOneBot();
    bot.trailLen = BOTS.ghost.minTrailLenCells + 5;
    trails._activeTrail.active = true;
    bot.pos = { x: 100, y: 100 };

    // First update consumes the initial 0 timer and fires.
    ai.update(0.01);

    expect(ai.getActiveGhosts()).toHaveLength(1);
    // Peer group registered for bot+ghost.
    expect(trails.setPeerGroup).toHaveBeenCalled();
  });

  it("destroys ghost when its id is reported in TrailCut", () => {
    const bot = spawnOneBot();
    bot.trailLen = BOTS.ghost.minTrailLenCells + 5;
    trails._activeTrail.active = true;
    bot.pos = { x: 100, y: 100 };

    ai.update(0.01);
    const ghosts = ai.getActiveGhosts();
    expect(ghosts).toHaveLength(1);
    const ghostId = ghosts[0]!.ghost.id;

    const scene = (ai as unknown as { scene: ReturnType<typeof makeScene> }).scene;
    scene.events.emit("trail:cut", { victim: ghostId, killer: 1 });

    expect(ai.getActiveGhosts()).toHaveLength(0);
    expect(trails.removeUnit).toHaveBeenCalledWith(ghostId);
  });

  it("removes ghost when its owner bot dies via TrailCut", () => {
    const bot = spawnOneBot();
    bot.trailLen = BOTS.ghost.minTrailLenCells + 5;
    trails._activeTrail.active = true;
    bot.pos = { x: 100, y: 100 };

    ai.update(0.01);
    expect(ai.getActiveGhosts()).toHaveLength(1);

    const scene = (ai as unknown as { scene: ReturnType<typeof makeScene> }).scene;
    scene.events.emit("trail:cut", { victim: bot.id, killer: 1 });

    expect(ai.getActiveGhosts()).toHaveLength(0);
  });
});
