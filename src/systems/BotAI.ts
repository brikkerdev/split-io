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
import type { PolygonTerritorySystem } from "./PolygonTerritorySystem";
import { TrailMover } from "./TrailMover";
import { circlePolygon, distanceToSegmentSqXY } from "@utils/polygon";
import { getBotNames } from "@/data/botNames";
import { locale } from "@systems/Locale";
import { SKINS, type SkinDef } from "@config/skins";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import { Vec2Pool } from "@utils/Vec2Pool";
import { arenaSlide } from "@utils/arena";
import { Ghost } from "@entities/Ghost";
import type { Vec2 } from "@gametypes/geometry";

export type BotProfileWeights = Partial<Record<BotProfileId, number>>;

export interface BotSpawnOpts {
  count: number;
  passive: boolean;
  profileWeights: BotProfileWeights;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure, testable)
// ---------------------------------------------------------------------------

const PROFILE_ORDER: readonly BotProfileId[] = [
  "aggressor",
  "tourist",
  "hoarder",
  "carver",
  "coward",
];

/** Weighted random pick from profile weights map. Missing keys default to 0. */
export function pickProfile(
  weights: BotProfileWeights,
  rand: () => number,
): BotProfileId {
  let total = 0;
  for (const id of PROFILE_ORDER) total += weights[id] ?? 0;
  if (total <= 0) return "aggressor";
  let r = rand() * total;
  for (const id of PROFILE_ORDER) {
    r -= weights[id] ?? 0;
    if (r < 0) return id;
  }
  return PROFILE_ORDER[PROFILE_ORDER.length - 1] as BotProfileId;
}

/** Build weights from aggression curve given current player %. */
export function weightsForPlayerPct(
  playerPct: number,
): Record<BotProfileId, number> {
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

  const baseFor = (id: BotProfileId): number =>
    BOTS.profiles.find((p) => p.id === id)?.weight ?? 0;

  // Carvers ramp once player owns enough land worth carving into.
  const carverMult = playerPct < 15 ? 0.4 : Math.min(2, mult);

  return {
    aggressor: baseFor("aggressor") * mult,
    tourist: baseFor("tourist"),
    hoarder: baseFor("hoarder"),
    carver: baseFor("carver") * carverMult,
    coward: baseFor("coward"),
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

interface CycleBuffState {
  speedMult: number;
  turnMult: number;
  countBonus: number;
  shootEnabled: boolean;
}

const GHOST_ID_OFFSET = 10000;

export class BotAI {
  private bots: Bot[] = [];
  private botById = new Map<number, Bot>();
  private nextId = 2; // hero = 1
  private nextGhostId = GHOST_ID_OFFSET;
  private playerPct = 0;
  private passive = false;
  /** Active ghost per bot (botId → Ghost). */
  private ghosts = new Map<number, Ghost>();
  /** Reverse lookup ghostId → owning botId for TrailCut handling. */
  private ghostOwners = new Map<number, number>();
  /** Per-bot ghost cooldown timers (seconds until next launch). */
  private shootTimers = new Map<number, number>();

  private readonly botColors: readonly number[];

  /** Accumulated buffs applied via applyCycleBuff(). */
  private cycleBuffs: CycleBuffState = {
    speedMult: 1,
    turnMult: 1,
    countBonus: 0,
    shootEnabled: false,
  };
  private cycleBuffCount = 0;

  /** Shared pool for posHistory Vec2 objects across all bots. */
  private readonly _pool = new Vec2Pool();
  /** Scratch Vec2 reused per moveBot call — avoids per-frame prevPos allocation. */
  private readonly _prevPos = { x: 0, y: 0 };

  private readonly trailMover: TrailMover;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly grid: GridSystem,
    private readonly trails: TrailSystem,
    private readonly hero: Hero,
    private readonly territory: PolygonTerritorySystem | null = null,
  ) {
    this.botColors = PALETTE.bots;
    this.trailMover = new TrailMover(trails, territory!);

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
      (payload: { victim: number; killer: number; worldX?: number; worldY?: number }) => {
        // Bot ghost was cut — destroy it and start cooldown.
        const ghostOwner = this.ghostOwners.get(payload.victim);
        if (ghostOwner !== undefined) {
          this.destroyBotGhost(ghostOwner, "killed");
          return;
        }

        const bot = this.botById.get(payload.victim);
        if (!bot || !bot.alive) return;
        bot.alive = false;
        this.clearBotPosHistory(bot);
        this.destroyBotGhost(bot.id, "killed");
        this.shootTimers.delete(bot.id);

        const deathX = payload.worldX;
        const deathY = payload.worldY;

        // Phase 1 (0–150 ms): keep trail data alive so renderer can animate
        // crumble/fade. Clear after trailFadeMs.
        this.scene.time.delayedCall(RENDER.botDeath.trailFadeMs, () => {
          this.trails.clearTrail(bot.id);
        });

        // Phase 2 (150 ms): explosion burst — emitted via scene event so
        // GameRenderer can handle it without a direct reference to BotAI internals.
        this.scene.time.delayedCall(RENDER.botDeath.explosionDelayMs, () => {
          this.scene.events.emit("bot:explosion", {
            x: deathX,
            y: deathY,
            color: bot.color,
            victim: payload.victim,
            killer: payload.killer,
          });
        });

        // Phase 3 (350 ms): dissolve territory. The dead bot's territory
        // always releases to neutral — it never transfers to the killer.
        const territory = this.territory;
        if (territory) {
          this.scene.time.delayedCall(RENDER.botDeath.dissolveDelayMs, () => {
            this.scene.events.emit("bot:dissolveStart", { ownerId: bot.id });
          });
          this.scene.time.delayedCall(RENDER.dissolveDurationMs, () => {
            territory.release(bot.id);
          });
        }
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

    const skinPool = this.buildBotSkinPool(opts.count);

    for (let i = 0; i < opts.count; i++) {
      const profile = pickProfile(opts.profileWeights, Math.random);
      const id = this.nextId++;
      const skin = skinPool[i % skinPool.length] as SkinDef;
      const color = skin.fill;
      const name = this.pickName(usedNames);

      const bot = new Bot(id, profile, name, color, skin.pattern, skin.id, skin.fillSecondary);

      // Place in a corner/edge quadrant away from hero.
      const { cx, cy } = this.pickSpawnCell(i, opts.count, cols, rows);
      bot.homeCx = cx;
      bot.homeCy = cy;
      bot.pos = this.grid.cellToWorld({ cx, cy });
      bot.returnX = bot.pos.x;
      bot.returnY = bot.pos.y;
      bot.heading = Math.random() * Math.PI * 2;
      bot.speedCellsPerSec = this.speedForProfile(profile);
      bot.state = "idle";
      bot.stateElapsed = Math.random() * BALANCE.botIdleDurationSec;
      bot.targetCx = -1;
      bot.targetCy = -1;
      bot.boldnessMult = this.rollBoldness(profile);

      // Claim a small starting territory for the bot.
      this.claimStartTerritory(bot);

      this.bots.push(bot);
      this.botById.set(bot.id, bot);
    }
  }

  update(dt: number): void {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      this.tickBot(bot, dt);
    }
    this.tickGhosts(dt);
  }

  getAll(): readonly Bot[] {
    return this.bots;
  }

  /** Revive a dead bot at the given cell with a fresh starting territory. */
  respawnAt(id: number, cell: { cx: number; cy: number }): void {
    const bot = this.botById.get(id);
    if (!bot || bot.alive) return;
    bot.homeCx = cell.cx;
    bot.homeCy = cell.cy;
    bot.pos = this.grid.cellToWorld(cell);
    bot.heading = Math.random() * Math.PI * 2;
    bot.speedCellsPerSec = this.speedForProfile(bot.profile);
    bot.state = "idle";
    bot.stateElapsed = 0;
    bot.trailLen = 0;
    this.clearBotPosHistory(bot);
    bot.alive = true;
    this.destroyBotGhost(bot.id, "killed");
    this.shootTimers.delete(bot.id);
    bot.targetCx = -1;
    bot.targetCy = -1;
    bot.boldnessMult = this.rollBoldness(bot.profile);
    this.claimStartTerritory(bot);
  }

  /**
   * Apply one level of cycle buff per GDD §3.2.
   * Called after each upgrade pick, before respawn.
   */
  applyCycleBuff(): void {
    this.cycleBuffCount += 1;
    this.cycleBuffs.speedMult *= 1.1;
    this.cycleBuffs.turnMult *= 1.05;
    this.cycleBuffs.countBonus = Math.min(
      this.cycleBuffs.countBonus + 2,
      BALANCE.botCountMax - BALANCE.botCountMin,
    );
    if (this.cycleBuffCount >= 3) {
      this.cycleBuffs.shootEnabled = true;
    }
  }

  getCycleBuffs(): Readonly<CycleBuffState> {
    return this.cycleBuffs;
  }

  /**
   * Respawn all dead bots with fresh positions.
   * Used on cycle reset.
   */
  respawnAll(): void {
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (!bot) continue;
      const cell = this.pickSpawnCell(i, this.bots.length, cols, rows);
      bot.homeCx = cell.cx;
      bot.homeCy = cell.cy;
      bot.pos = this.grid.cellToWorld(cell);
      bot.returnX = bot.pos.x;
      bot.returnY = bot.pos.y;
      bot.heading = Math.random() * Math.PI * 2;
      bot.speedCellsPerSec = this.speedForProfile(bot.profile);
      bot.state = "idle";
      bot.stateElapsed = 0;
      bot.trailLen = 0;
      this.clearBotPosHistory(bot);
      bot.alive = true;
      bot.targetCx = -1;
      bot.targetCy = -1;
      bot.boldnessMult = this.rollBoldness(bot.profile);
      this.claimStartTerritory(bot);
    }
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryCaptured, undefined, this);
    this.scene.events.off(GameEvents.TrailCut, undefined, this);
    for (const ghost of this.ghosts.values()) {
      this.trails.clearTrail(ghost.id);
      this.trails.removeUnit(ghost.id);
    }
    this.ghosts.clear();
    this.ghostOwners.clear();
    this.shootTimers.clear();
    this.bots.length = 0;
    this.botById.clear();
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
    const preferredLen = (profile?.preferredTrailLen ?? 10) * bot.boldnessMult;

    // Steer outward from arena center so the bot pushes into neutral land at
    // its current frontier point rather than back along the radial spoke
    // anchored at the spawn cell.
    const awayAngle = angleTo(MAP.centerX, MAP.centerY, bot.pos.x, bot.pos.y);
    const turnRate = BALANCE.botTurnRateRadPerSec * _dt;
    bot.heading = steerToward(bot.heading, awayAngle, turnRate);

    const trail = this.trails.get(bot.id);
    bot.trailLen = trail?.polylineLength() ?? 0;

    if (bot.trailLen >= preferredLen * 0.4) {
      return "cutOrLoop";
    }
    return "leaveHome";
  }

  private stateCutOrLoop(bot: Bot, dt: number): BotState {
    const profile = this.profileOf(bot);
    const preferredLen = profile.preferredTrailLen * bot.boldnessMult;
    const trail = this.trails.get(bot.id);
    bot.trailLen = trail?.polylineLength() ?? 0;
    const turnRate = BALANCE.botTurnRateRadPerSec * dt;

    // Trail full — bring the bulge home to claim land.
    if (bot.trailLen >= preferredLen || bot.trailLen >= BALANCE.botMaxTrailCells) {
      bot.targetCx = -1;
      bot.targetCy = -1;
      this.refreshReturnAnchor(bot);
      return "returnHome";
    }

    // Pick or refresh expansion target.
    if (bot.targetCx < 0 || bot.targetCy < 0) {
      this.pickExpansionTarget(bot);
    } else {
      const tw2 = this.grid.cellToWorld({ cx: bot.targetCx, cy: bot.targetCy });
      if (this.territory?.isOwnedBy(tw2.x, tw2.y, bot.id)) {
        // Target landed inside own territory after a recent capture — repick.
        this.pickExpansionTarget(bot);
      }
    }

    const tw = this.grid.cellToWorld({ cx: bot.targetCx, cy: bot.targetCy });
    const distToTarget = distCells(bot.pos.x, bot.pos.y, tw.x, tw.y, this.grid.cellPx);
    if (distToTarget < 1.5) {
      // Reached the frontier point — head home with whatever trail we have.
      bot.targetCx = -1;
      bot.targetCy = -1;
      if (bot.trailLen >= 3) {
        this.refreshReturnAnchor(bot);
        return "returnHome";
      }
      this.pickExpansionTarget(bot);
    }

    const targetAngle = angleTo(bot.pos.x, bot.pos.y, tw.x, tw.y);
    bot.heading = steerToward(bot.heading, targetAngle, turnRate);

    this.applySafetyLookahead(bot, turnRate);
    return "cutOrLoop";
  }

  /**
   * Pick an expansion goal: a cell at preferredTrailLen * (0.5..0.9) from the
   * bot's home, biased outward from arena center so bots don't crowd inward.
   * Avoids own territory so the trail must actually leave home to reach it.
   */
  private pickExpansionTarget(bot: Bot): void {
    const profile = this.profileOf(bot);
    const cellPx = this.grid.cellPx;
    // Anchor expansion at the bot's current position (a perimeter point on
    // its own territory after returnHome) so successive wedges fan around
    // the territory border instead of all radiating from the spawn cell.
    const anchor = { x: bot.pos.x, y: bot.pos.y };
    const arenaCenter = { x: MAP.centerX, y: MAP.centerY };
    const outward = angleTo(arenaCenter.x, arenaCenter.y, anchor.x, anchor.y);
    const safeR = MAP.radiusPx - cellPx * 3;
    const preferredLen = profile.preferredTrailLen * bot.boldnessMult;

    // Aim outward with a wide jitter sweep — the bot's curved path plus the
    // perimeter return anchor naturally form a wedge, and randomized aim
    // angles spread captures over neutral land instead of repeating spokes.
    const tangentBase = outward;

    for (let attempt = 0; attempt < 8; attempt++) {
      const distCells = preferredLen * (0.7 + Math.random() * 0.5);
      // Wide spread so consecutive cycles cover different sectors. Later
      // attempts widen further if early tries land in own territory.
      const jitterSpan = attempt < 4 ? Math.PI * 0.7 : Math.PI * 1.2;
      const angle = tangentBase + (Math.random() - 0.5) * jitterSpan;
      let tx = anchor.x + Math.cos(angle) * distCells * cellPx;
      let ty = anchor.y + Math.sin(angle) * distCells * cellPx;
      const ddx = tx - arenaCenter.x;
      const ddy = ty - arenaCenter.y;
      const r = Math.sqrt(ddx * ddx + ddy * ddy);
      if (r > safeR) {
        const k = safeR / r;
        tx = arenaCenter.x + ddx * k;
        ty = arenaCenter.y + ddy * k;
      }
      const cell = this.grid.worldToCell({ x: tx, y: ty });
      if (!this.grid.inBounds(cell.cx, cell.cy)) continue;
      if (this.territory?.isOwnedBy(tx, ty, bot.id)) continue;
      bot.targetCx = cell.cx;
      bot.targetCy = cell.cy;
      return;
    }
    // Fallback: aim straight outward at half preferred length.
    const fallbackDist = preferredLen * 0.7 * cellPx;
    let tx = anchor.x + Math.cos(outward) * fallbackDist;
    let ty = anchor.y + Math.sin(outward) * fallbackDist;
    const ddx = tx - arenaCenter.x;
    const ddy = ty - arenaCenter.y;
    const r = Math.sqrt(ddx * ddx + ddy * ddy);
    if (r > safeR) {
      const k = safeR / r;
      tx = arenaCenter.x + ddx * k;
      ty = arenaCenter.y + ddy * k;
    }
    const cell = this.grid.worldToCell({ x: tx, y: ty });
    bot.targetCx = cell.cx;
    bot.targetCy = cell.cy;
  }

  private stateReturnHome(bot: Bot, dt: number): BotState {
    // If trail was already closed (touching own territory), go idle immediately.
    const trail = this.trails.get(bot.id);
    if (trail && !trail.active) {
      return "idle";
    }

    const dist = distCells(bot.pos.x, bot.pos.y, bot.returnX, bot.returnY, this.grid.cellPx);

    const returnAngle = angleTo(bot.pos.x, bot.pos.y, bot.returnX, bot.returnY);
    const turnRate = BALANCE.botTurnRateRadPerSec * dt;
    bot.heading = steerToward(bot.heading, returnAngle, turnRate * 4);

    if (dist <= BALANCE.botHomeRadiusCells) {
      return "idle";
    }
    return "returnHome";
  }

  /**
   * Snapshot the closest point on this bot's own territory boundary as the
   * return target. Falls back to the spawn cell when territory is empty
   * (e.g. just respawned and starting territory hasn't been claimed yet).
   */
  private refreshReturnAnchor(bot: Bot): void {
    const t = this.territory;
    if (t) {
      const p = t.getNearestOwnerPoint(bot.id, bot.pos);
      if (p) {
        bot.returnX = p.x;
        bot.returnY = p.y;
        return;
      }
    }
    const home = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    bot.returnX = home.x;
    bot.returnY = home.y;
  }

  // ---------------------------------------------------------------------------
  // Profile steering
  // ---------------------------------------------------------------------------

  private profileOf(bot: Bot) {
    return (
      BOTS.profiles.find((p) => p.id === bot.profile) ??
      (BOTS.profiles[0] as (typeof BOTS.profiles)[number])
    );
  }

  /**
   * Single-probe lookahead. If the cell two ahead is the bot's own trail or
   * outside the arena, nudge 90° toward home. Deliberately dumb — bots will
   * occasionally still clip themselves, which keeps the game beatable.
   */
  private applySafetyLookahead(bot: Bot, turnRate: number): void {
    const cellPx = this.grid.cellPx;
    const ahead = 2;
    const px = bot.pos.x + Math.cos(bot.heading) * ahead * cellPx;
    const py = bot.pos.y + Math.sin(bot.heading) * ahead * cellPx;

    const blockedByWall = (() => {
      const ddx = px - MAP.centerX;
      const ddy = py - MAP.centerY;
      const safeR = MAP.radiusPx - cellPx * 1.5;
      return ddx * ddx + ddy * ddy > safeR * safeR;
    })();

    let blockedBySelf = false;
    const trail = this.trails.get(bot.id);
    if (trail?.active && trail.polylineLength() >= 2) {
      const forgive = RENDER.trail.colliderRadiusPx;
      const forgiveSq = forgive * forgive;
      const polyline = trail.getPolyline();
      const limit = polyline.length - 1;
      for (let i = 0; i < limit; i++) {
        const a = polyline[i] as { x: number; y: number };
        const b = polyline[i + 1] as { x: number; y: number };
        // Cheap bbox reject — segments far from probe contribute nothing.
        const minX = a.x < b.x ? a.x : b.x;
        const maxX = a.x > b.x ? a.x : b.x;
        if (px < minX - forgive || px > maxX + forgive) continue;
        const minY = a.y < b.y ? a.y : b.y;
        const maxY = a.y > b.y ? a.y : b.y;
        if (py < minY - forgive || py > maxY + forgive) continue;
        const dsq = distanceToSegmentSqXY(px, py, a.x, a.y, b.x, b.y);
        if (dsq <= forgiveSq) {
          blockedBySelf = true;
          break;
        }
      }
    }

    if (!blockedByWall && !blockedBySelf) return;

    const home = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const homeAngle = angleTo(bot.pos.x, bot.pos.y, home.x, home.y);
    const turnSign = wrapAngle(homeAngle - bot.heading) >= 0 ? 1 : -1;
    bot.heading = steerToward(bot.heading, bot.heading + turnSign * Math.PI * 0.5, turnRate * 4);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private moveBot(bot: Bot, dt: number): void {
    const cellPx = this.grid.cellPx;
    const dx = Math.cos(bot.heading) * bot.speedCellsPerSec * cellPx * dt;
    const dy = Math.sin(bot.heading) * bot.speedCellsPerSec * cellPx * dt;

    // Capture pre-move pos to anchor the trail back to the territory edge.
    this._prevPos.x = bot.pos.x;
    this._prevPos.y = bot.pos.y;
    const prevOnOwn = this.territory?.isOwnedBy(this._prevPos.x, this._prevPos.y, bot.id) ?? false;

    // Slide along the arena rim instead of radially clamping — clamping
    // bleeds the bot's velocity to zero against the boundary and pins it.
    const slid = arenaSlide(bot.pos.x, bot.pos.y, dx, dy);
    bot.pos.x = slid.x;
    bot.pos.y = slid.y;
    if (slid.hit) bot.heading = slid.heading;

    const oldPos = { x: this._prevPos.x, y: this._prevPos.y };

    const trailBefore = this.trails.get(bot.id);
    const wasActive = trailBefore?.active === true && (trailBefore?.polylineLength() ?? 0) > 0;

    const result = this.trailMover.step(bot.id, bot.id, oldPos, bot.pos, {
      sampleDistSqPx: RENDER.trail.sampleDistPx * RENDER.trail.sampleDistPx,
      cutForgivePx: RENDER.trail.colliderRadiusPx,
    });

    const newOnOwn = this.territory?.isOwnedBy(bot.pos.x, bot.pos.y, bot.id) ?? false;

    if (newOnOwn) {
      if (wasActive || result === "closed") {
        this.trails.clearTrail(bot.id);
        this.clearBotPosHistory(bot);
        bot.trailLen = 0;
      }
    } else {
      // Anchor visual polyline at the territory exit point.
      if (!wasActive && prevOnOwn) {
        bot.posHistory.push(this._pool.acquire(this._prevPos.x, this._prevPos.y));
      }
      this.appendPosHistory(bot, bot.pos.x, bot.pos.y);
    }
  }

  // ---------------------------------------------------------------------------
  // Bot ghosts — bots fire a Ghost that captures land on closure with the
  // bot's own pre-launch trail and cuts hero/other-bot trails on contact.
  // Mirrors GhostSystem semantics so closure / cut feel uniform.
  // ---------------------------------------------------------------------------

  /** Snapshot of active ghosts paired with their owning bot ids (renderer hook). */
  getActiveGhosts(): readonly { botId: number; ghost: Ghost; color: number }[] {
    const out: { botId: number; ghost: Ghost; color: number }[] = [];
    for (const [botId, ghost] of this.ghosts) {
      const bot = this.botById.get(botId);
      if (!bot) continue;
      out.push({ botId, ghost, color: bot.color });
    }
    return out;
  }

  private tickGhosts(dt: number): void {
    // Tick existing ghost flights.
    if (this.ghosts.size > 0) {
      const toDestroy: Array<{ botId: number; reason: "fallback" }> = [];
      for (const [botId, ghost] of this.ghosts) {
        const bot = this.botById.get(botId);
        if (!bot || !bot.alive) {
          toDestroy.push({ botId, reason: "fallback" });
          continue;
        }
        if (this.tickGhostFlight(bot, ghost, dt)) {
          // tickGhostFlight already handled destruction.
        }
      }
      for (const item of toDestroy) {
        this.destroyBotGhost(item.botId, item.reason);
      }
    }

    // Cooldown / fire decisions per living bot.
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      if (this.passive) continue;
      if (this.ghosts.has(bot.id)) continue;

      let timer = this.shootTimers.get(bot.id) ?? 0;
      timer -= dt;
      if (timer <= 0) {
        if (this.canFireGhost(bot)) {
          this.spawnBotGhost(bot);
        }
        const cfg = BOTS.ghost;
        const jitter = 1 + (Math.random() - 0.5) * 2 * cfg.cooldownJitter;
        timer = cfg.cooldownSec * jitter;
      }
      this.shootTimers.set(bot.id, timer);
    }
  }

  private canFireGhost(bot: Bot): boolean {
    if (!this.territory) return false;
    // Like the hero ghost: only launch while the bot is outside its own
    // territory and has an active trail to close with.
    if (this.territory.isOwnedBy(bot.pos.x, bot.pos.y, bot.id)) return false;
    const trail = this.trails.get(bot.id);
    if (!trail?.active) return false;
    if (trail.polylineLength() < 2) return false;
    if (bot.trailLen < BOTS.ghost.minTrailLenCells) return false;
    return true;
  }

  private spawnBotGhost(bot: Bot): void {
    const cfg = BOTS.ghost;
    const id = this.nextGhostId++;
    const ghost = new Ghost(id, bot.id);
    const speedPxPerSec = bot.speedCellsPerSec * this.grid.cellPx * cfg.speedMult;
    ghost.spawn(bot.pos, bot.heading, speedPxPerSec, cfg.preflySec, cfg.maxLifetimeSec);

    this.ghosts.set(bot.id, ghost);
    this.ghostOwners.set(id, bot.id);
    this.trails.ensure(id);
    // Bot + its ghost share a peer group — bot won't kill its own ghost trail
    // and ghost re-entering bot territory triggers closure, not cut.
    this.trails.setPeerGroup(bot.id, [bot.id, id]);

    const botTrail = this.trails.get(bot.id);
    if (botTrail !== undefined && botTrail.polylineLength() > 0) {
      ghost.spawnPolyline = botTrail.getPolyline().slice();
    }
  }

  /** Returns true when ghost was destroyed this tick. */
  private tickGhostFlight(bot: Bot, ghost: Ghost, dt: number): boolean {
    const territory = this.territory;
    if (!territory) {
      this.destroyBotGhost(bot.id, "fallback");
      return true;
    }

    const prevX = ghost.pos.x;
    const prevY = ghost.pos.y;
    const newPhase = ghost.tick(dt);
    if (newPhase === "fallback") {
      this.destroyBotGhost(bot.id, "fallback");
      return true;
    }

    const slid = arenaSlide(prevX, prevY, ghost.pos.x - prevX, ghost.pos.y - prevY);
    ghost.pos.x = slid.x;
    ghost.pos.y = slid.y;
    if (slid.hit) ghost.heading = slid.heading;

    if (!territory.isOwnedBy(ghost.pos.x, ghost.pos.y, bot.id)) {
      ghost.hasLeftHome = true;
    } else if (ghost.hasLeftHome) {
      ghost.inHomeTimer += dt;
    }

    const dx = ghost.pos.x - ghost.spawnPos.x;
    const dy = ghost.pos.y - ghost.spawnPos.y;
    const guardPx = BOTS.ghost.spawnGuardCells * this.grid.cellPx;
    if (ghost.hasLeftHome && dx * dx + dy * dy > guardPx * guardPx) {
      const result = this.trails.appendAndTest(
        ghost.id,
        ghost.pos,
        bot.id,
        undefined,
        ghost.spawnPolyline,
        { x: prevX, y: prevY },
      );
      if (result === "closed") {
        this.salvageBotTrail(bot);
        this.destroyBotGhost(bot.id, "captured");
        return true;
      }
    }

    this.appendGhostHistory(ghost);

    if (ghost.inHomeTimer >= BOTS.ghost.inOwnHomeMaxSec) {
      this.destroyBotGhost(bot.id, "fallback");
      return true;
    }

    if (!ghost.alive) {
      this.destroyBotGhost(bot.id, "killed");
      return true;
    }
    return false;
  }

  private destroyBotGhost(botId: number, _reason: "captured" | "killed" | "fallback"): void {
    const ghost = this.ghosts.get(botId);
    if (!ghost) return;
    ghost.kill();
    this._pool.releaseAll(ghost.posHistory);
    ghost.posHistory.length = 0;
    this.trails.clearTrail(ghost.id);
    this.trails.removeUnit(ghost.id);
    this.ghosts.delete(botId);
    this.ghostOwners.delete(ghost.id);
    // Restore bot to its solo peer group; ghost.id mapping is dropped via
    // removeUnit above which clears the group entry too.
    this.trails.setPeerGroup(botId, [botId]);
  }

  /**
   * After a ghost-captured closure, prune the bot trail to keep only the
   * tail still outside own territory. Mirrors GhostSystem.salvageHeroTrail.
   */
  private salvageBotTrail(bot: Bot): void {
    const territory = this.territory;
    if (!territory) return;
    const trail = this.trails.get(bot.id);
    const polyline: readonly Vec2[] =
      trail !== undefined ? trail.getPolyline().slice() : [];

    let firstOutside = polyline.length;
    for (let i = polyline.length - 1; i >= 0; i--) {
      const p = polyline[i];
      if (p === undefined) break;
      if (territory.isOwnedBy(p.x, p.y, bot.id)) break;
      firstOutside = i;
    }

    this.trails.clearTrail(bot.id);

    if (firstOutside < polyline.length) {
      const sampleDistSqPx = RENDER.trail.sampleDistPx * RENDER.trail.sampleDistPx;
      for (let i = firstOutside; i < polyline.length; i++) {
        const p = polyline[i];
        if (p === undefined) continue;
        this.trails.addPoint(bot.id, p.x, p.y, sampleDistSqPx);
      }
    }

    const hist = bot.posHistory;
    let firstOutsideHist = hist.length;
    for (let i = hist.length - 1; i >= 0; i--) {
      const p = hist[i];
      if (p === undefined) break;
      if (territory.isOwnedBy(p.x, p.y, bot.id)) break;
      firstOutsideHist = i;
    }
    if (firstOutsideHist > 0) {
      const removed = hist.splice(0, firstOutsideHist);
      this._pool.releaseAll(removed);
    }
  }

  private appendGhostHistory(ghost: Ghost): void {
    const hist = ghost.posHistory;
    const last = hist[hist.length - 1];
    if (last !== undefined) {
      const dx = ghost.pos.x - last.x;
      const dy = ghost.pos.y - last.y;
      const threshold = RENDER.trail.sampleDistPx;
      if (dx * dx + dy * dy < threshold * threshold) return;
    }
    hist.push(this._pool.acquire(ghost.pos.x, ghost.pos.y));
    if (hist.length > RENDER.trail.maxHistoryLen) {
      const evicted = hist.shift();
      if (evicted !== undefined) this._pool.release(evicted);
    }
  }

  private clearBotPosHistory(bot: Bot): void {
    this._pool.releaseAll(bot.posHistory);
    bot.posHistory.length = 0;
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
    hist.push(this._pool.acquire(x, y));
    if (hist.length > RENDER.trail.maxHistoryLen) {
      const evicted = hist.shift();
      if (evicted !== undefined) this._pool.release(evicted);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Pick a unique skin per bot from the full SKINS pool, weighted toward
   * rare/legendary entries so the player sees enviable cosmetics in play.
   * Hero's currently selected skin is excluded to avoid identity confusion.
   */
  private buildBotSkinPool(count: number): SkinDef[] {
    let heroSkin = "";
    try {
      heroSkin = saves.get<SaveV1>().selectedSkin;
    } catch { /* save not loaded yet */ }

    const candidates = SKINS.filter((s) => s.id !== heroSkin);
    // Each rarity tier gets a weight — bots wear cool stuff more often.
    const rarityWeight = (s: SkinDef): number => {
      switch (s.rarity) {
        case "legendary": return 4;
        case "epic":      return 3;
        case "rare":      return 2;
        default:          return 1;
      }
    };

    const weighted: SkinDef[] = [];
    for (const s of candidates) {
      const w = rarityWeight(s);
      for (let k = 0; k < w; k++) weighted.push(s);
    }
    // Shuffle and dedupe so each bot gets a unique skin.
    for (let i = weighted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weighted[i], weighted[j]] = [weighted[j] as SkinDef, weighted[i] as SkinDef];
    }
    const seen = new Set<string>();
    const unique: SkinDef[] = [];
    for (const s of weighted) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      unique.push(s);
      if (unique.length >= count) break;
    }
    // If we somehow have fewer unique skins than bots, allow repeats.
    while (unique.length < count) {
      const s = candidates[Math.floor(Math.random() * candidates.length)];
      if (s) unique.push(s);
    }
    void this.botColors; // keep field for potential fallback paths
    return unique;
  }

  private pickName(used: Set<string>): string {
    const all = getBotNames(locale.getLang());
    const available = all.filter((n) => !used.has(n));
    const pool = available.length > 0 ? available : all;
    const name = pool[Math.floor(Math.random() * pool.length)] ?? "Bot";
    used.add(name);
    return name;
  }

  /**
   * Random per-bot greed multiplier. Bolder profiles skew higher so a carver
   * is rarely timid, but every profile rolls a wide range so the player sees
   * a mix of small arcs and big sweeping land grabs in the same match.
   */
  private rollBoldness(profile: BotProfileId): number {
    const p = BOTS.profiles.find((x) => x.id === profile);
    const base = p?.boldness ?? 0.5;
    // Map boldness (0..1) to a center in [0.85..1.55], then jitter ±0.45.
    const center = 0.85 + base * 0.7;
    const jitter = (Math.random() - 0.5) * 0.9;
    return Math.max(0.55, Math.min(2.0, center + jitter));
  }

  private speedForProfile(profile: BotProfileId): number {
    const base = BALANCE.botBaseSpeedCellsPerSec * this.cycleBuffs.speedMult;
    switch (profile) {
      case "aggressor": return base * BALANCE.botAggressorSpeedMult;
      case "tourist":   return base * BALANCE.botTouristSpeedMult;
      case "hoarder":   return base * BALANCE.botHoarderSpeedMult;
      case "carver":    return base * BALANCE.botCarverSpeedMult;
      case "coward":    return base * BALANCE.botCowardSpeedMult;
    }
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
    const homeWorld = this.grid.cellToWorld({ cx: bot.homeCx, cy: bot.homeCy });
    const r = GRID.startTerritoryRadiusCells * this.grid.cellPx;
    this.territory?.claim(bot.id, circlePolygon(homeWorld.x, homeWorld.y, r, 32));
  }
}
