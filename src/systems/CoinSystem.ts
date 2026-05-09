import { GameEvents } from "@events/GameEvents";
import { ECONOMY } from "@config/economy";
import { Economy } from "@systems/Economy";
import type { TerritoryCapturedPayload, TrailCutPayload, CoinEarnedPayload, CoinTotalPayload } from "@gametypes/events";

export class CoinSystem {
  private heroId = 0;
  /** Resolves the active hero-ghost id so kills via ghost trail credit the player. */
  private ghostIdProvider: (() => number | null) | null = null;
  /** Resolves the hero's world position so territory-step coins spawn there. */
  private heroPosProvider: (() => { x: number; y: number } | null) | null = null;
  /**
   * Highest hero territory percent seen this round.
   * Used to award coins for each 2%-step threshold crossed (monotonic),
   * so retaking lost ground does not double-pay.
   */
  private maxPctReached = 0;
  /** Victim ids already paid out — prevents double-credit on duplicate TrailCut. */
  private paidVictims = new Set<number>();
  /** Coins awarded to the hero during the current round only. */
  private coinsThisRound = 0;

  constructor(
    private scene: { events: { on: (key: string, cb: (p: unknown) => void) => void; off: (key: string) => void; emit: (key: string, payload: unknown) => void } },
    private economy: Economy,
  ) {
    this.bindEvents();
  }

  setHeroId(id: number): void {
    this.heroId = id;
  }

  setGhostIdProvider(fn: () => number | null): void {
    this.ghostIdProvider = fn;
  }

  setHeroPosProvider(fn: () => { x: number; y: number } | null): void {
    this.heroPosProvider = fn;
  }

  /** Reset accumulated pct on round start so step counter is fresh. */
  reset(): void {
    this.maxPctReached = 0;
    this.paidVictims.clear();
    this.coinsThisRound = 0;
  }

  /** Coins earned by the hero in the current round. */
  getRoundCoins(): number {
    return this.coinsThisRound;
  }

  /** Total coins held by the economy (including all-time balance). */
  getTotalCoins(): number {
    return this.economy.getCoins();
  }

  /** Add coins directly (e.g. double-coins reward). Emits CoinTotalChanged. */
  addCoins(amount: number): void {
    this.economy.add(amount);
    const total: CoinTotalPayload = { total: this.economy.getCoins() };
    this.scene.events.emit(GameEvents.CoinTotalChanged, total);
  }

  private bindEvents(): void {
    const ev = this.scene.events;

    ev.on(GameEvents.TerritoryCaptured, (raw: unknown) => {
      const payload = raw as TerritoryCapturedPayload;
      if (this.heroId === 0 || payload.ownerId !== this.heroId) return;

      // payload.pct is the hero's total owned territory percent. Award one
      // coin per `coinsPerTerritoryStepPct` threshold crossed, but only once
      // per threshold per round (monotonic on max-pct-reached).
      if (payload.pct <= this.maxPctReached) return;

      const step = ECONOMY.coinsPerTerritoryStepPct;
      const prevSteps = Math.floor(this.maxPctReached / step);
      const newSteps = Math.floor(payload.pct / step);
      this.maxPctReached = payload.pct;

      const coinsEarned = newSteps - prevSteps;
      if (coinsEarned <= 0) return;

      // Spawn the flyer at the hero's position so the coin visibly originates
      // from where the territory was captured. Fall back to camera centre if
      // the provider is unavailable (e.g. hero just died this frame).
      const heroPos = this.heroPosProvider?.() ?? null;
      let worldX: number;
      let worldY: number;
      if (heroPos) {
        worldX = heroPos.x;
        worldY = heroPos.y;
      } else {
        const scene = this.scene as unknown as { cameras?: { main?: { scrollX: number; scrollY: number; width: number; height: number } } };
        const cam = scene.cameras?.main;
        worldX = cam ? cam.scrollX + cam.width / 2 : 0;
        worldY = cam ? cam.scrollY + cam.height / 2 : 0;
      }

      this.awardCoins(coinsEarned, worldX, worldY, "territory");
    });

    ev.on(GameEvents.TrailCut, (raw: unknown) => {
      const payload = raw as TrailCutPayload;
      if (this.heroId === 0) return;
      if (payload.victim === this.heroId) return;
      const ghostId = this.ghostIdProvider?.() ?? null;
      const isHeroKill =
        payload.killer === this.heroId ||
        (ghostId !== null && payload.killer === ghostId);
      if (!isHeroKill) return;
      if (payload.victim === payload.killer) return;
      if (this.paidVictims.has(payload.victim)) return;
      this.paidVictims.add(payload.victim);

      // Prefer world coords from payload (cut point), fallback to camera centre.
      let worldX = payload.worldX;
      let worldY = payload.worldY;
      if (worldX === undefined || worldY === undefined) {
        const scene = this.scene as unknown as { cameras?: { main?: { scrollX: number; scrollY: number; width: number; height: number } } };
        const cam = scene.cameras?.main;
        worldX = cam ? cam.scrollX + cam.width / 2 : 0;
        worldY = cam ? cam.scrollY + cam.height / 2 : 0;
      }

      this.awardCoins(ECONOMY.coinsPerKill, worldX, worldY, "kill");
    });
  }

  private awardCoins(amount: number, worldX: number, worldY: number, reason: CoinEarnedPayload["reason"]): void {
    this.economy.add(amount);
    this.coinsThisRound += amount;

    const earned: CoinEarnedPayload = { amount, worldX, worldY, reason };
    this.scene.events.emit(GameEvents.CoinEarned, earned);

    const total: CoinTotalPayload = { total: this.economy.getCoins() };
    this.scene.events.emit(GameEvents.CoinTotalChanged, total);
  }

  destroy(): void {
    this.scene.events.off(GameEvents.TerritoryCaptured);
    this.scene.events.off(GameEvents.TrailCut);
  }
}
