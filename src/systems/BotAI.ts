import type Phaser from "phaser";
import { Bot } from "@entities/Bot";
import type { BotState } from "@entities/Bot";
import { BOTS } from "@config/bots";
import type { BotProfileId } from "@config/bots";
import { BALANCE } from "@config/balance";
import { PALETTE } from "@config/palette";
import { GRID } from "@config/grid";
import { RENDER } from "@config/render";
import { GameEvents } from "@events/GameEvents";
import type { TerritoryCapturedPayload } from "@gametypes/events";
import type { Hero } from "@entities/Hero";
import { MAP } from "@config/map";
import type { GridSystem } from "./GridSystem";
import type { TrailSystem } from "./TrailSystem";
import type { TerritorySystem } from "./TerritorySystem";
import { BOT_NAMES } from "@/data/botNames";

export interface BotSpawnOpts {
  count: number;
  passive: boolean;
  profileWeights: Record<BotProfileId, number>;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure, testable)
// ---------------------------------------------------------------------------

/** Weighted random pick from profile weights map. */
export function pickProfile(
  weights: Record<BotProfileId, number>,
  rand: () => number,
): BotProfileId {
  const total = weights.aggressor + weights.tourist + weights.hoarder;
  let r = rand() * total;
  if ((r -= weights.aggressor) < 0) return "aggressor";
  if ((r -= weights.tourist) < 0) return "tourist";
  return "hoarder";
}

/** Build weights from aggression curve given current player %. */
export function weightsForPlayerPct(playerPct: number): Record<BotProfileId, number> {
  const curve = BOTS.aggressionVsPlayerCurve;
  let mult: number = curve[0]?.mult ?? 1;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (a === undefined || b === undefined) continue;
    if (playerPct >= a.playerPct && playerPct <= b.playerPct) {
      const t = (playerPct - a.playerPct) / (b.playerPct - a.playerPct);
      mult = a.mult + (b.mult - a.mult) * t;
      break;
    }
    if (playerPct > b.playerPct) mult = b.mult;
  }

  const baseAggressor = BOTS.profiles.find((p) => p.id === "aggressor")?.weight ?? 0.35;
  const baseTourist = BOTS.profiles.find((p) => p.id === "tourist")?.weight ?? 0.4;
  const baseHoarder = BOTS.profiles.find((p) => p.id === "hoarder")?.weight ?? 0.25;

  return {
    aggressor: baseAggressor * mult,
    tourist: baseTourist,
    hoarder: baseHoarder,
  };
}

/** Angle from (ax,ay) toward (bx,by) in radians. */
export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

/** Wrap angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  const pi2 = Math.PI * 2;
  let r = a % pi2;
  if (r > Math.PI) r -= pi2;
  if (r < -Math.PI) r += pi2;
  return r;
}

/** Steer `current` toward `target` by at most `maxDelta` rad. */
export function steerToward(current: number, target: number, maxDelta: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** Distance in cells between two world positions. */
export function distCells(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cellPx: number,
): number {
  const dx = (bx - ax) / cellPx;
  const dy = (by - ay) / cellPx;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// BotAI system
// ---------------------------------------------------------------------------

export class BotAI {
  private bots: Bot[] = [];
  private nextId = 2; // hero = 1
  private playerPct = 0;
  private passive = false;

  private readonly botColors: readonly number[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly grid: GridSystem,
    private readonly trails: TrailSystem,
    private readonly hero: Hero,
    private readonly territory: TerritorySystem | null = null,
  ) {
    this.botColors = PALETTE.bots;

    scene.events.on(
      GameEvents.TerritoryCaptured,
      (payload: TerritoryCapturedPayload) => {
        if (payload.ownerId === this.hero.id) {
          this.playerPct = payload.pct;
        }
      },
      this,
    );

    scene.events.on(
      GameEvents.TrailCut,
      (payload: { victim: number; killer: number }) => {
        const bot = this.bots.find((b) => b.id === payload.victim);
        if (!bot || !bot.alive) return;
        bot.alive = false;
        bot.posHistory = [];
        this.trails.clearTrail(bot.id);
        this.territory?.releaseOwner(bot.id);
      },
      this,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  spawn(opts: BotSpawnOpts): void {
    this.passive = opts.passive;
    const usedNames = new Set<string>();
    const cols = this.grid.cols;
    const rows = this.grid.rows;

    for (let i = 0; i < opts.count; i++) {
      const profile = pickProfile(opts.profileWeights, Math.random);
      const id = this.nextId++;
      const color = this.botColors[(id - 2) % this.botColors.length] ?? 0xff5252;
      const name = this.pickName(usedNames);

      const bot = new Bot(id, profile, name, color);

      // Place in a corner/edge quadrant away from hero.
      const { cx, cy } = this.pickSpawnCell(i, opts.count, cols, rows);
      bot.homeCx = cx;
      bot.homeCy = cy;
      bot.pos = this.grid.cellToWorld({ cx, cy });
      bot.heading = Math.random() * Math.PI * 2;
      bot.speedCellsPerSec = this.speedForProfile(profile);
      bot.state = "idle";
      bot.stateElapsed = Math.random() * BALANCE.botIdleDurationSec;

      // Claim a small starting territory for the bot.
      this.claimStartTerritory(bot);

      this.bots.push(bot);
    }
  }

  update(dt: number): void {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      this.tickBot(bot, dt);
    }
  }

  getAll(): readonly Bot[] {
    return this.bots;
  }

  /** Revive a dead bot at the given cell with a fresh starting territory. */
  respawnAt(id: number, cell: { cx: number; cy: number }): void {
    const bot = this.bots.find((b) => b.id === id);
    if (!bot || bot.alive) return;
    bot.homeCx = cell.cx;
    bot.homeCy = cell.cy;
    bot.pos = this.grid.cellToWorld(cell);
    bot.heading = Math.random() * Math.PI * 2;
    bot.speedCellsPerSec = this.speedForProfile(bot.profile);
    bot.state = "idle";
    bot.stateElapsed = 0;
    bot.trailLen = 0;
    bot.posHistory = [];
    bot.alive = true;
    this.claimStartTerritory(bot);
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryCaptured, undefined, this);
    this.scene.events.off(GameEvents.TrailCut, undefined, this);
    this.bots.length = 0;
  }

  // ---------------------------------------------------------------------------
  // FSM per bot
  // ---------------------------------------------------------------------------

  private tickBot(bot: Bot, dt: number): void {
    bot.stateElapsed += dt;

    const nextState = this.passive
      ? this.tickPassive(bot, dt)
      : this.tickFSM(bot, dt);

    if (nextState !== bot.state) {
      bot.state = nextState;
      bot.stateElapsed = 0;
    }

    this.moveBot(bot, dt);
  }

  private tickPassive(bot: Bot, _dt: number): BotState {
    // Passive bots orbit their home.
    const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const orbitAngle = angleTo(homeWorld.x, homeWorld.y, bot.pos.x, bot.pos.y);
    bot.heading = wrapAngle(orbitAngle + Math.PI * 0.5);
    return "cutOrLoop";
  }

  private tickFSM(bot: Bot, dt: number): BotState {
    switch (bot.state) {
      case "idle":
        return this.stateIdle(bot);
      case "leaveHome":
        return this.stateLeaveHome(bot, dt);
      case "cutOrLoop":
        return this.stateCutOrLoop(bot, dt);
      case "returnHome":
        return this.stateReturnHome(bot, dt);
    }
  }

  private stateIdle(bot: Bot): BotState {
    if (bot.stateElapsed >= BALANCE.botIdleDurationSec) {
      return "leaveHome";
    }
    return "idle";
  }

  private stateLeaveHome(bot: Bot, _dt: number): BotState {
    const profile = BOTS.profiles.find((p) => p.id === bot.profile);
    const preferredLen = profile?.preferredTrailLen ?? 10;

    // Steer away from home center.
    const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const awayAngle = angleTo(homeWorld.x, homeWorld.y, bot.pos.x, bot.pos.y);
    const turnRate = BALANCE.botTurnRateRadPerSec * _dt;
    bot.heading = steerToward(bot.heading, awayAngle, turnRate);

    const trail = this.trails.get(bot.id);
    bot.trailLen = trail?.length ?? 0;

    if (bot.trailLen >= preferredLen * 0.4) {
      return "cutOrLoop";
    }
    return "leaveHome";
  }

  private stateCutOrLoop(bot: Bot, dt: number): BotState {
    const profile = BOTS.profiles.find((p) => p.id === bot.profile);
    const preferredLen = profile?.preferredTrailLen ?? 10;
    const trail = this.trails.get(bot.id);
    bot.trailLen = trail?.length ?? 0;

    if (bot.trailLen >= preferredLen || bot.trailLen >= BALANCE.botMaxTrailCells) {
      return "returnHome";
    }

    const turnRate = BALANCE.botTurnRateRadPerSec * dt;

    if (bot.profile === "aggressor") {
      this.steerAggressor(bot, turnRate);
    } else if (bot.profile === "tourist") {
      this.steerTourist(bot, turnRate);
    } else {
      this.steerHoarder(bot, turnRate);
    }

    return "cutOrLoop";
  }

  private stateReturnHome(bot: Bot, dt: number): BotState {
    // If trail was already closed (touching own territory), go idle immediately.
    const trail = this.trails.get(bot.id);
    if (trail && !trail.active) {
      return "idle";
    }

    const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const dist = distCells(bot.pos.x, bot.pos.y, homeWorld.x, homeWorld.y, this.grid.cellPx);

    const returnAngle = angleTo(bot.pos.x, bot.pos.y, homeWorld.x, homeWorld.y);
    const turnRate = BALANCE.botTurnRateRadPerSec * dt;
    bot.heading = steerToward(bot.heading, returnAngle, turnRate * 4);

    if (dist <= BALANCE.botHomeRadiusCells) {
      return "idle";
    }
    return "returnHome";
  }

  // ---------------------------------------------------------------------------
  // Profile steering
  // ---------------------------------------------------------------------------

  private steerAggressor(bot: Bot, turnRate: number): void {
    const profile = BOTS.profiles.find((p) => p.id === "aggressor");
    const radius = (profile?.aggressionRadiusCells ?? 18) * this.grid.cellPx;

    // Find nearest enemy trail cell within radius.
    let bestDist = radius;
    let bestX = -1;
    let bestY = -1;

    for (const other of this.bots) {
      if (other.id === bot.id || !other.alive) continue;
      const trail = this.trails.get(other.id);
      if (!trail?.active) continue;
      const cells = trail.getCells();
      const cols = this.grid.cols;
      for (const packed of cells) {
        const cx = packed % cols;
        const cy = Math.floor(packed / cols);
        const wp = this.grid.cellToWorld({ cx, cy });
        const d = distCells(bot.pos.x, bot.pos.y, wp.x, wp.y, this.grid.cellPx);
        if (d < bestDist) {
          bestDist = d;
          bestX = wp.x;
          bestY = wp.y;
        }
      }
    }

    // Also check hero trail.
    const heroTrail = this.trails.get(this.hero.id);
    if (heroTrail?.active) {
      const cols = this.grid.cols;
      for (const packed of heroTrail.getCells()) {
        const cx = packed % cols;
        const cy = Math.floor(packed / cols);
        const wp = this.grid.cellToWorld({ cx, cy });
        const d = distCells(bot.pos.x, bot.pos.y, wp.x, wp.y, this.grid.cellPx);
        if (d < bestDist) {
          bestDist = d;
          bestX = wp.x;
          bestY = wp.y;
        }
      }
    }

    if (bestX >= 0) {
      const target = angleTo(bot.pos.x, bot.pos.y, bestX, bestY);
      bot.heading = steerToward(bot.heading, target, turnRate);
    } else {
      // Wander at speed.
      bot.heading = wrapAngle(bot.heading + (Math.random() - 0.5) * 0.4);
    }
  }

  private steerTourist(bot: Bot, turnRate: number): void {
    // Small clockwise loop near home.
    const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const orbitAngle = angleTo(homeWorld.x, homeWorld.y, bot.pos.x, bot.pos.y);
    const targetHeading = wrapAngle(orbitAngle + Math.PI * 0.5);
    bot.heading = steerToward(bot.heading, targetHeading, turnRate);
  }

  private steerHoarder(bot: Bot, turnRate: number): void {
    // Large counter-clockwise sweep from home, avoiding others.
    const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const orbitAngle = angleTo(homeWorld.x, homeWorld.y, bot.pos.x, bot.pos.y);
    const targetHeading = wrapAngle(orbitAngle - Math.PI * 0.6);
    bot.heading = steerToward(bot.heading, targetHeading, turnRate * 0.7);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private moveBot(bot: Bot, dt: number): void {
    const cellPx = this.grid.cellPx;
    const dx = Math.cos(bot.heading) * bot.speedCellsPerSec * cellPx * dt;
    const dy = Math.sin(bot.heading) * bot.speedCellsPerSec * cellPx * dt;

    let newX = bot.pos.x + dx;
    let newY = bot.pos.y + dy;

    // Circular boundary: turn toward home if hitting the edge.
    const ddx = newX - MAP.centerX;
    const ddy = newY - MAP.centerY;
    if (ddx * ddx + ddy * ddy > MAP.radiusPx * MAP.radiusPx) {
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const k = MAP.radiusPx / dist;
      newX = MAP.centerX + ddx * k;
      newY = MAP.centerY + ddy * k;
      const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
      bot.heading = angleTo(newX, newY, homeWorld.x, homeWorld.y);
    }

    bot.pos.x = newX;
    bot.pos.y = newY;

    // Update trail via TrailSystem when outside home.
    const { cx, cy } = this.grid.worldToCell(bot.pos);
    const cellOwner = this.grid.ownerOf(cx, cy);

    if (cellOwner !== bot.id) {
      // Outside own territory: add cell to trail and check for collisions.
      this.trails.addCellToTrail(bot.id, cx, cy);
      this.trails.checkTrailCollision(bot.id, cx, cy);

      // Record world position for smooth trail rendering.
      this.appendPosHistory(bot, newX, newY);
    } else {
      // Re-entered own territory: close any active trail (triggers flood-fill).
      const trail = this.trails.get(bot.id);
      if (trail && trail.active && trail.length > 0) {
        this.trails.checkTrailCollision(bot.id, cx, cy);
        this.trails.clearTrail(bot.id);
        bot.posHistory = [];
        // Flag that the loop was closed so FSM can idle immediately.
        bot.trailLen = 0;
      }
    }
  }

  private appendPosHistory(bot: Bot, x: number, y: number): void {
    const hist = bot.posHistory;
    const last = hist[hist.length - 1];
    if (last !== undefined) {
      const dx = x - last.x;
      const dy = y - last.y;
      const dist2 = dx * dx + dy * dy;
      const threshold = RENDER.trail.sampleDistPx;
      if (dist2 < threshold * threshold) return;
    }
    hist.push({ x, y });
    if (hist.length > RENDER.trail.maxHistoryLen) {
      hist.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private pickName(used: Set<string>): string {
    const available = BOT_NAMES.filter((n) => !used.has(n));
    const pool = available.length > 0 ? available : BOT_NAMES;
    const name = pool[Math.floor(Math.random() * pool.length)] ?? "Bot";
    used.add(name);
    return name;
  }

  private speedForProfile(profile: BotProfileId): number {
    const base = BALANCE.botBaseSpeedCellsPerSec;
    if (profile === "aggressor") return base * BALANCE.botAggressorSpeedMult;
    if (profile === "tourist") return base * BALANCE.botTouristSpeedMult;
    return base * BALANCE.botHoarderSpeedMult;
  }

  private pickSpawnCell(
    index: number,
    total: number,
    cols: number,
    rows: number,
  ): { cx: number; cy: number } {
    const margin = GRID.startTerritoryRadiusCells + 2;
    const baseAngle = (index / total) * Math.PI * 2;
    const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / total);
    const radiusFrac = 0.18 + Math.random() * 0.24;
    const rx = Math.floor(cols * radiusFrac);
    const ry = Math.floor(rows * radiusFrac);
    const rawCx = Math.round(cols / 2 + Math.cos(angle) * rx);
    const rawCy = Math.round(rows / 2 + Math.sin(angle) * ry);
    return {
      cx: Math.max(margin, Math.min(cols - 1 - margin, rawCx)),
      cy: Math.max(margin, Math.min(rows - 1 - margin, rawCy)),
    };
  }

  private claimStartTerritory(bot: Bot): void {
    const r = GRID.startTerritoryRadiusCells;
    const packed: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = bot.homeCx + dx;
        const cy = bot.homeCy + dy;
        if (this.grid.inBounds(cx, cy) && this.grid.ownerOf(cx, cy) === 0) {
          packed.push(cy * this.grid.cols + cx);
        }
      }
    }
    this.territory?.claimCells(bot.id, packed);
  }
}
