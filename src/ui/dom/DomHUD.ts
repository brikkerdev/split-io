import { GameEvents } from "@events/GameEvents";
import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";
import { JoystickEvents } from "@systems/InputSystem";
import type { JoystickShowPayload, JoystickMovePayload } from "@systems/InputSystem";
import type {
  CooldownUpdatePayload,
  LeaderboardEntry,
  LeaderboardUpdatePayload,
  UpgradeOfferPayload,
  CoinEarnedPayload,
  CoinTotalPayload,
} from "@gametypes/events";
import { t } from "./i18n";

interface CycleStartPayload {
  cycle: number;
}

const LEADERBOARD_TOP = 3;
const HERO_NEIGHBORS = 1;
const COIN_FLYER_MAX = 8;

type LbRowItem = { kind: "row"; rank: number; entry: LeaderboardEntry };
type LbSepItem = { kind: "sep"; label: string };
type LbItem = LbRowItem | LbSepItem;

function colorToHex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

const RING_RADIUS = 46;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export class DomHUD {
  private root: HTMLElement;
  private leaderboardEl!: HTMLElement;
  private leaderboardListEl!: HTMLElement;
  private splitRingEl!: SVGCircleElement;
  private splitRingWrap!: HTMLElement;
  private splitLabelEl!: HTMLElement;
  private coinsEl!: HTMLElement;
  private coinsCountEl!: HTMLElement;
  private cycleLabelEl!: HTMLElement;

  private gameEvents!: Phaser.Events.EventEmitter;
  private game!: Phaser.Game;
  private heroId = 0; // kept for API compat — leaderboard uses isHero flag from payload

  private activeFlyerCount = 0;

  // Leaderboard diff cache — avoid full innerHTML rebuild when data is unchanged
  private lbCacheKey = "";

  // Hero percent tick animation state
  private _heroPctEl: HTMLElement | null = null;
  private _heroPctDisplayed = 0;
  private _heroPctTarget = 0;
  private _heroPctRaf = 0;
  private _heroPctStart = 0;
  private _heroPctFrom = 0;
  private _heroPctBouncing = false;

  // Coin flyer rect cache — refreshed on resize, not per-flyer
  private cachedCanvasRect: DOMRect | null = null;
  private cachedOverlayRect: DOMRect | null = null;
  private cachedCounterRect: DOMRect | null = null;
  private rectCacheRaf = 0;

  // Joystick cached half-width — read once on show, not on every move
  private stickBaseRadius = 0;

  // RAF handle for batched joystick knob writes
  private joystickRaf = 0;
  private pendingKnobDx = 0;
  private pendingKnobDy = 0;

  // Coin pulse — track whether animation is already running
  private coinPulseTimeout: ReturnType<typeof globalThis.setTimeout> | 0 = 0;

  // Floating joystick DOM elements (mobile only)
  private stickBase!: HTMLElement;
  private stickKnob!: HTMLElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "hud";
    this.root.className = "ui-screen";
    this.build();
  }

  setHeroId(id: number): void {
    this.heroId = id;
  }

  mount(game: Phaser.Game, gameEvents: Phaser.Events.EventEmitter): void {
    this.game = game;
    this.gameEvents = gameEvents;
    this.gameEvents.on(GameEvents.LeaderboardUpdate, this.onLeaderboard, this);
    this.gameEvents.on(GameEvents.SplitCooldown, this.onSplitCooldown, this);
    this.gameEvents.on(GameEvents.CoinTotalChanged, this.onCoinTotal, this);
    this.gameEvents.on(GameEvents.CoinEarned, this.onCoinEarned, this);
    this.gameEvents.on(GameEvents.CycleStart, this.onCycleStart, this);
    this.gameEvents.on(JoystickEvents.Show, this.onJoystickShow, this);
    this.gameEvents.on(JoystickEvents.Move, this.onJoystickMove, this);
    this.gameEvents.on(JoystickEvents.Hide, this.onJoystickHide, this);

    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);

    // Seed counter from persisted balance so it doesn't read 0 until the first
    // CoinTotalChanged event fires this round.
    this.coinsCountEl.textContent = String(saves.get<SaveV1>().coins ?? 0);

    // Move the joystick out of #ui-overlay. The overlay runs CSS shake
    // animations (`transform: translate`) on capture/death, and a transformed
    // ancestor pulls `position: fixed` descendants along with it. Hosting the
    // stick in <body> keeps it anchored to the cursor regardless of HUD shake.
    document.body.appendChild(this.stickBase);

    // Animate in
    requestAnimationFrame(() => {
      this.root.classList.add("visible");
    });

    // Invalidate rect cache on resize so coin flyers don't drift.
    // Phaser relays window resize via scale.RESIZE — no need for a separate window listener.
    game.scale.on(Phaser.Scale.Events.RESIZE, this.invalidateRectCache);
  }

  unmount(): void {
    this.root.classList.remove("visible");
    setTimeout(() => {
      this.root.remove();
      this.stickBase.remove();
    }, 160);

    if (this.game?.scale) {
      this.game.scale.off(Phaser.Scale.Events.RESIZE, this.invalidateRectCache);
    }

    if (this.joystickRaf) {
      cancelAnimationFrame(this.joystickRaf);
      this.joystickRaf = 0;
    }

    if (this._heroPctRaf) {
      cancelAnimationFrame(this._heroPctRaf);
      this._heroPctRaf = 0;
    }
    this._heroPctEl = null;

    if (this.rectCacheRaf) {
      cancelAnimationFrame(this.rectCacheRaf);
      this.rectCacheRaf = 0;
    }

    if (this.coinPulseTimeout) {
      clearTimeout(this.coinPulseTimeout);
      this.coinPulseTimeout = 0;
    }

    if (this.gameEvents) {
      this.gameEvents.off(GameEvents.LeaderboardUpdate, this.onLeaderboard, this);
      this.gameEvents.off(GameEvents.SplitCooldown, this.onSplitCooldown, this);
      this.gameEvents.off(GameEvents.CoinTotalChanged, this.onCoinTotal, this);
      this.gameEvents.off(GameEvents.CoinEarned, this.onCoinEarned, this);
      this.gameEvents.off(GameEvents.CycleStart, this.onCycleStart, this);
      this.gameEvents.off(JoystickEvents.Show, this.onJoystickShow, this);
      this.gameEvents.off(JoystickEvents.Move, this.onJoystickMove, this);
      this.gameEvents.off(JoystickEvents.Hide, this.onJoystickHide, this);
    }
  }

  showUpgradeModal(payload: UpgradeOfferPayload, onPick: (id: string) => void): void {
    // Upgrade modal is handled by DomUpgradeModal — emit to game.events so it can respond
    this.game.events.emit("ui:upgrade:offer", payload, onPick);
  }

  // ── Private builders ──────────────────────────────────────

  private build(): void {
    this.root.innerHTML = `
      <button class="hud-pause-btn" id="hud-pause-btn" aria-label="${escapeHtml(t("hud_pause"))}">
        <i class="ph ph-pause"></i>
      </button>

      <div class="hud-top">
        <div class="hud-coins" id="hud-coins">
          <i class="ph ph-coin hud-coins__icon"></i>
          <span class="hud-coins__count" id="hud-coins-count">0</span>
          <span class="hud-cycle-label" id="hud-cycle-label"></span>
        </div>
        <div class="hud-leaderboard" id="hud-leaderboard">
          <span class="hud-leaderboard__label" data-i18n="hud_leaderboard"></span>
          <ol class="hud-leaderboard__list" id="hud-lb-list"></ol>
        </div>
      </div>

      <div class="hud-split" id="hud-split">
        <div class="hud-split__ring" id="hud-split-ring">
          <svg viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg" overflow="visible">
            <circle class="hud-split__ring-bg" cx="55" cy="55" r="${RING_RADIUS}"/>
            <circle class="hud-split__ring-fill" id="hud-ring-fill"
              cx="55" cy="55" r="${RING_RADIUS}"
              stroke-dasharray="${RING_CIRC}"
              stroke-dashoffset="${RING_CIRC}"/>
          </svg>
          <div class="hud-split__icon"><i class="ph ph-lightning"></i></div>
        </div>
        <span class="hud-split__label" id="hud-split-label" data-i18n="hud_split_ready"></span>
      </div>

      <div class="joystick-base" id="joystick-base">
        <div class="joystick-knob" id="joystick-knob"></div>
      </div>
    `;

    const pauseBtn = this.root.querySelector("#hud-pause-btn") as HTMLElement;
    pauseBtn.addEventListener("click", () => {
      this.game?.events.emit("pause:toggle", true);
    });

    this.leaderboardEl = this.root.querySelector("#hud-leaderboard") as HTMLElement;
    this.leaderboardListEl = this.root.querySelector("#hud-lb-list") as HTMLElement;
    this.splitRingEl = this.root.querySelector("#hud-ring-fill") as unknown as SVGCircleElement;
    this.splitRingWrap = this.root.querySelector("#hud-split-ring") as HTMLElement;
    this.splitLabelEl = this.root.querySelector("#hud-split-label") as HTMLElement;
    this.coinsEl = this.root.querySelector("#hud-coins") as HTMLElement;
    this.coinsCountEl = this.root.querySelector("#hud-coins-count") as HTMLElement;
    this.cycleLabelEl = this.root.querySelector("#hud-cycle-label") as HTMLElement;
    this.stickBase = this.root.querySelector("#joystick-base") as HTMLElement;
    this.stickKnob = this.root.querySelector("#joystick-knob") as HTMLElement;

    // Apply locale
    this.root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n ?? "");
    });
  }

  // ── Rect cache ────────────────────────────────────────────

  private readonly invalidateRectCache = (): void => {
    if (this.rectCacheRaf) return;
    this.rectCacheRaf = requestAnimationFrame(() => {
      this.rectCacheRaf = 0;
      this.cachedCanvasRect = null;
      this.cachedOverlayRect = null;
      this.cachedCounterRect = null;
    });
  };

  private getCanvasRect(): DOMRect {
    if (!this.cachedCanvasRect) {
      this.cachedCanvasRect = this.game.canvas.getBoundingClientRect();
    }
    return this.cachedCanvasRect;
  }

  private getOverlayRect(overlay: HTMLElement): DOMRect {
    if (!this.cachedOverlayRect) {
      this.cachedOverlayRect = overlay.getBoundingClientRect();
    }
    return this.cachedOverlayRect;
  }

  private getCounterRect(): DOMRect {
    if (!this.cachedCounterRect) {
      this.cachedCounterRect = this.coinsEl.getBoundingClientRect();
    }
    return this.cachedCounterRect;
  }

  // ── Event handlers ────────────────────────────────────────

  private onCoinTotal(payload: CoinTotalPayload): void {
    this.coinsCountEl.textContent = String(payload.total);
  }

  private onCycleStart(payload: CycleStartPayload): void {
    if (payload.cycle > 0) {
      this.cycleLabelEl.textContent = t("cycle_label").replace("%{n}", String(payload.cycle));
    }
  }

  private onCoinEarned(payload: CoinEarnedPayload): void {
    if (this.activeFlyerCount >= COIN_FLYER_MAX) {
      return;
    }

    const overlay = document.getElementById("ui-overlay");
    if (!overlay) return;

    // Use cached rects — one getBCR per frame max (invalidated on resize)
    const rect = this.getCanvasRect();
    const overlayRect = this.getOverlayRect(overlay);
    const counterRect = this.getCounterRect();

    const cam = this.game.scene.getScene("Game")
      ? (this.game.scene.getScene("Game") as unknown as { cameras?: { main?: { scrollX: number; scrollY: number; zoom: number } } }).cameras?.main
      : null;

    const zoom = cam?.zoom ?? 1;
    const scrollX = cam?.scrollX ?? 0;
    const scrollY = cam?.scrollY ?? 0;

    const scaleX = rect.width / this.game.scale.width;
    const scaleY = rect.height / this.game.scale.height;

    const screenX = rect.left + (payload.worldX - scrollX) * zoom * scaleX - overlayRect.left;
    const screenY = rect.top + (payload.worldY - scrollY) * zoom * scaleY - overlayRect.top;

    const targetX = counterRect.left + counterRect.width / 2 - overlayRect.left;
    const targetY = counterRect.top + counterRect.height / 2 - overlayRect.top;

    const flyer = document.createElement("div");
    flyer.className = "coin-flyer";
    flyer.textContent = "+1";
    flyer.style.left = `${screenX}px`;
    flyer.style.top = `${screenY}px`;
    overlay.appendChild(flyer);

    this.activeFlyerCount++;

    // Schedule transform in next frame to avoid forced sync layout on insertion
    requestAnimationFrame(() => {
      flyer.style.transform = `translate(${targetX - screenX}px, ${targetY - screenY}px)`;
      flyer.style.opacity = "0";
    });

    const cleanup = (): void => {
      flyer.remove();
      this.activeFlyerCount--;
      this.triggerCoinPulse();
    };

    flyer.addEventListener("transitionend", cleanup, { once: true });
    globalThis.setTimeout(cleanup, 700);
  }

  private triggerCoinPulse(): void {
    if (this.coinPulseTimeout) {
      // Animation already scheduled — just let it finish, counter text is already updated
      return;
    }
    // CSS-only restart: remove class, let RAF confirm it's gone, re-add
    this.coinsEl.classList.remove("hud-coins--pulse");
    requestAnimationFrame(() => {
      this.coinsEl.classList.add("hud-coins--pulse");
      this.coinPulseTimeout = globalThis.setTimeout(() => {
        this.coinsEl.classList.remove("hud-coins--pulse");
        this.coinPulseTimeout = 0;
      }, 200);
    });
  }

  private onLeaderboard(payload: LeaderboardUpdatePayload): void {
    const items = this.buildLeaderboardItems(payload);

    // Cache key — fingerprints rendered set so we skip on no-op updates
    let cacheKey = "";
    for (const it of items) {
      if (it.kind === "sep") {
        cacheKey += `S:${it.label}|`;
      } else {
        const e = it.entry;
        cacheKey += `${it.rank}:${e.id}:${e.percent.toFixed(1)}:${e.alive ? 1 : 0}:${e.isHero ? 1 : 0}|`;
      }
    }
    if (cacheKey === this.lbCacheKey) return;
    this.lbCacheKey = cacheKey;

    const list = this.leaderboardListEl;
    const existing = list.children;

    for (let di = 0; di < items.length; di++) {
      const d = items[di] as LbItem;
      const li = (di < existing.length ? existing[di] : null) as HTMLLIElement | null;

      if (d.kind === "sep") {
        if (li) {
          if (!li.classList.contains("hud-lb__sep-label") || li.textContent !== d.label) {
            li.className = "hud-lb__sep-label";
            li.setAttribute("aria-hidden", "true");
            li.textContent = d.label;
          }
        } else {
          const newLi = document.createElement("li");
          newLi.className = "hud-lb__sep-label";
          newLi.setAttribute("aria-hidden", "true");
          newLi.textContent = d.label;
          list.appendChild(newLi);
        }
      } else {
        if (li) {
          if (li.classList.contains("hud-lb__sep-label") || li.classList.contains("hud-lb__sep")) {
            li.removeAttribute("aria-hidden");
            this.buildRowSpans(li);
          }
          this.patchRow(li, d.rank, d.entry);
        } else {
          const newLi = document.createElement("li");
          this.buildRowSpans(newLi);
          this.patchRow(newLi, d.rank, d.entry);
          list.appendChild(newLi);
        }
      }
    }

    while (list.children.length > items.length) {
      list.lastElementChild?.remove();
    }
  }

  /**
   * Build display items for the HUD leaderboard:
   *  - Always include the top {LEADERBOARD_TOP} ranks.
   *  - If the hero sits below that range, add a "Your position" segment with
   *    the hero ±{HERO_NEIGHBORS} neighbors. Ranges that touch the top block
   *    merge into a single contiguous list (no separator).
   */
  private buildLeaderboardItems(payload: LeaderboardUpdatePayload): LbItem[] {
    const entries = payload.entries;
    const total = entries.length;
    if (total === 0) return [];

    const heroIdx = entries.findIndex((e) => e.isHero);
    const heroRank = heroIdx === -1 ? -1 : heroIdx + 1;

    const topEnd = Math.min(LEADERBOARD_TOP, total);
    const items: LbItem[] = [];

    // Top block: ranks 1..topEnd
    for (let i = 0; i < topEnd; i++) {
      items.push({ kind: "row", rank: i + 1, entry: entries[i] as LeaderboardEntry });
    }

    if (heroIdx === -1 || heroRank <= topEnd) return items;

    // Hero-context block: ranks [heroRank-N .. heroRank+N], clipped to bounds
    const ctxFrom = Math.max(1, heroRank - HERO_NEIGHBORS);
    const ctxTo = Math.min(total, heroRank + HERO_NEIGHBORS);

    if (ctxFrom > topEnd + 1) {
      items.push({ kind: "sep", label: t("hud_lb_your_position") });
    }
    const start = Math.max(topEnd + 1, ctxFrom);
    for (let r = start; r <= ctxTo; r++) {
      items.push({ kind: "row", rank: r, entry: entries[r - 1] as LeaderboardEntry });
    }

    return items;
  }

  private buildRowSpans(li: HTMLLIElement): void {
    li.innerHTML =
      '<span class="hud-lb__rank"></span>' +
      '<span class="hud-lb__swatch"></span>' +
      '<span class="hud-lb__name"></span>' +
      '<span class="hud-lb__pct"></span>';
  }

  private patchRow(li: HTMLLIElement, rank: number, entry: LeaderboardEntry): void {
    const cls = [
      "hud-lb__row",
      entry.isHero ? "is-hero" : "",
      !entry.alive ? "is-dead" : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (li.className !== cls) li.className = cls;

    // Ensure spans exist (li may have been a sep before)
    if (!li.querySelector(".hud-lb__rank")) {
      this.buildRowSpans(li);
    }

    const spans = li.children;
    const rankEl = spans[0] as HTMLElement;
    const swatchEl = spans[1] as HTMLElement;
    const nameEl = spans[2] as HTMLElement;
    const pctEl = spans[3] as HTMLElement;

    const rankStr = String(rank);
    if (rankEl.textContent !== rankStr) rankEl.textContent = rankStr;

    const swatch = colorToHex(entry.color);
    if (swatchEl.style.background !== swatch) swatchEl.style.background = swatch;

    const name = escapeHtml(entry.name);
    if (nameEl.textContent !== name) nameEl.textContent = name;

    if (entry.isHero) {
      // Animated tick for hero row only.
      const next = entry.percent;
      if (Math.abs(next - this._heroPctTarget) >= 0.05) {
        this._animateHeroPct(pctEl, this._heroPctDisplayed, next);
      }
    } else {
      const pct = `${entry.percent.toFixed(1)}%`;
      if (pctEl.textContent !== pct) pctEl.textContent = pct;
    }
  }

  private onSplitCooldown(payload: CooldownUpdatePayload): void {
    const total = payload.total > 0 ? payload.total : 1;
    const ratio = Math.max(0, Math.min(1, 1 - payload.remaining / total));
    const ready = payload.remaining <= 0;

    const filled = RING_CIRC * ratio;
    const offset = RING_CIRC - filled;
    this.splitRingEl.setAttribute("stroke-dashoffset", String(offset));

    if (ready) {
      this.splitRingWrap.classList.add("ready");
      this.splitLabelEl.textContent = t("hud_split_ready");
    } else {
      this.splitRingWrap.classList.remove("ready");
      this.splitLabelEl.textContent = "";
    }
  }

  /**
   * Phaser pointer coords are in game-space (canvas internal resolution).
   * Convert to viewport-space CSS pixels — the joystick is `position: fixed`
   * in <body>, so its left/top are viewport-relative.
   */
  private gameToViewport(gx: number, gy: number): { x: number; y: number } {
    const canvas = this.game?.canvas;
    if (!canvas) return { x: gx, y: gy };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.game.scale.width;
    const scaleY = rect.height / this.game.scale.height;
    return {
      x: rect.left + gx * scaleX,
      y: rect.top + gy * scaleY,
    };
  }

  private onJoystickShow(payload: JoystickShowPayload): void {
    // Cache offsetWidth here so onJoystickMove never reads layout
    this.stickBaseRadius = this.stickBase.offsetWidth / 2;

    const p = this.gameToViewport(payload.originX, payload.originY);
    this.stickBase.style.left = `${p.x - this.stickBaseRadius}px`;
    this.stickBase.style.top = `${p.y - this.stickBaseRadius}px`;
    this.stickKnob.style.transform = "translate(-50%, -50%)";
    this.stickBase.classList.add("active");
  }

  private onJoystickMove(payload: JoystickMovePayload): void {
    const o = this.gameToViewport(payload.originX, payload.originY);
    const k = this.gameToViewport(payload.knobX, payload.knobY);
    this.pendingKnobDx = k.x - o.x;
    this.pendingKnobDy = k.y - o.y;

    // Batch: schedule write once per frame
    if (!this.joystickRaf) {
      this.joystickRaf = requestAnimationFrame(() => {
        this.joystickRaf = 0;
        this.stickKnob.style.transform =
          `translate(calc(-50% + ${this.pendingKnobDx}px), calc(-50% + ${this.pendingKnobDy}px))`;
      });
    }
  }

  private onJoystickHide(_payload: unknown): void {
    if (this.joystickRaf) {
      cancelAnimationFrame(this.joystickRaf);
      this.joystickRaf = 0;
    }
    this.stickBase.classList.remove("active");
    this.stickKnob.style.transform = "translate(-50%, -50%)";
  }

  // ── Hero percent tick ─────────────────────────────────────

  private _animateHeroPct(el: HTMLElement, from: number, to: number): void {
    if (this._heroPctRaf) {
      cancelAnimationFrame(this._heroPctRaf);
      this._heroPctRaf = 0;
    }

    const increasing = to > from;
    this._heroPctEl = el;
    this._heroPctFrom = from;
    this._heroPctTarget = to;
    this._heroPctStart = performance.now();

    if (increasing && !this._heroPctBouncing) {
      this._heroPctBouncing = true;
      el.classList.remove("hud-lb__pct--bounce");
      // Force reflow to restart animation.
      void el.offsetWidth;
      el.classList.add("hud-lb__pct--bounce");
      const bounceDuration = 220;
      globalThis.setTimeout(() => {
        el.classList.remove("hud-lb__pct--bounce");
        this._heroPctBouncing = false;
      }, bounceDuration);
    }

    const tickDuration = 80;
    const step = (now: number): void => {
      const elapsed = now - this._heroPctStart;
      const t = Math.min(1, elapsed / tickDuration);
      const current = this._heroPctFrom + (this._heroPctTarget - this._heroPctFrom) * t;
      this._heroPctDisplayed = current;
      if (this._heroPctEl) {
        this._heroPctEl.textContent = `${current.toFixed(1)}%`;
      }
      if (t < 1) {
        this._heroPctRaf = requestAnimationFrame(step);
      } else {
        this._heroPctRaf = 0;
        this._heroPctDisplayed = this._heroPctTarget;
        if (this._heroPctEl) {
          this._heroPctEl.textContent = `${this._heroPctTarget.toFixed(1)}%`;
        }
      }
    };
    this._heroPctRaf = requestAnimationFrame(step);
  }
}
