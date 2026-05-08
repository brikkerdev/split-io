import { GameEvents } from "@events/GameEvents";
import { JoystickEvents } from "@systems/InputSystem";
import type { JoystickShowPayload, JoystickMovePayload } from "@systems/InputSystem";
import type {
  CooldownUpdatePayload,
  LeaderboardEntry,
  LeaderboardUpdatePayload,
  UpgradeOfferPayload,
} from "@gametypes/events";
import { t } from "./i18n";

const LEADERBOARD_VISIBLE = 5;

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

const RING_RADIUS = 38;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export class DomHUD {
  private root: HTMLElement;
  private leaderboardEl!: HTMLElement;
  private leaderboardListEl!: HTMLElement;
  private splitRingEl!: SVGCircleElement;
  private splitRingWrap!: HTMLElement;
  private splitLabelEl!: HTMLElement;
  private hintEl!: HTMLElement;

  private hintDismissed = false;
  private gameEvents!: Phaser.Events.EventEmitter;
  private game!: Phaser.Game;
  private heroId = 0; // kept for API compat — leaderboard uses isHero flag from payload

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
    this.gameEvents.once("input:firstmove", this.dismissHint, this);
    this.gameEvents.on(JoystickEvents.Show, this.onJoystickShow, this);
    this.gameEvents.on(JoystickEvents.Move, this.onJoystickMove, this);
    this.gameEvents.on(JoystickEvents.Hide, this.onJoystickHide, this);

    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);

    // Animate in
    requestAnimationFrame(() => {
      this.root.classList.add("visible");
    });
  }

  unmount(): void {
    this.root.classList.remove("visible");
    setTimeout(() => {
      this.root.remove();
    }, 160);

    if (this.gameEvents) {
      this.gameEvents.off(GameEvents.LeaderboardUpdate, this.onLeaderboard, this);
      this.gameEvents.off(GameEvents.SplitCooldown, this.onSplitCooldown, this);
      this.gameEvents.off("input:firstmove", this.dismissHint, this);
      this.gameEvents.off(JoystickEvents.Show, this.onJoystickShow, this);
      this.gameEvents.off(JoystickEvents.Move, this.onJoystickMove, this);
      this.gameEvents.off(JoystickEvents.Hide, this.onJoystickHide, this);
    }
  }

  showUpgradeModal(payload: UpgradeOfferPayload, onPick: (id: string) => void): void {
    // Upgrade modal is handled by DomUpgradeModal — emit to game.events so it can respond
    this.game.events.emit("ui:upgrade:offer", payload, onPick);
  }

  dismissHint(): void {
    if (this.hintDismissed) return;
    this.hintDismissed = true;
    this.hintEl.classList.add("hidden");
  }

  // ── Private builders ──────────────────────────────────────

  private build(): void {
    this.root.innerHTML = `
      <button class="hud-pause-btn" id="hud-pause-btn" aria-label="Pause">
        <i class="ph ph-pause"></i>
      </button>

      <div class="hud-top">
        <div class="hud-leaderboard" id="hud-leaderboard">
          <span class="hud-leaderboard__label" data-i18n="hud_leaderboard"></span>
          <ol class="hud-leaderboard__list" id="hud-lb-list"></ol>
        </div>
      </div>

      <div class="hud-hint" id="hud-hint">
        <span class="hud-hint__arrow"><i class="ph ph-arrow-up"></i></span>
        <span class="hud-hint__text" data-i18n="hud_hint_move"></span>
      </div>

      <div class="hud-split" id="hud-split">
        <div class="hud-split__ring" id="hud-split-ring">
          <svg viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
            <circle class="hud-split__ring-bg" cx="44" cy="44" r="${RING_RADIUS}"/>
            <circle class="hud-split__ring-fill" id="hud-ring-fill"
              cx="44" cy="44" r="${RING_RADIUS}"
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
    this.hintEl = this.root.querySelector("#hud-hint") as HTMLElement;
    this.stickBase = this.root.querySelector("#joystick-base") as HTMLElement;
    this.stickKnob = this.root.querySelector("#joystick-knob") as HTMLElement;

    // Apply locale
    this.root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n ?? "");
    });
  }

  // ── Event handlers ────────────────────────────────────────

  private onLeaderboard(payload: LeaderboardUpdatePayload): void {
    const top = payload.entries.slice(0, LEADERBOARD_VISIBLE);
    const heroIncluded = top.some((e) => e.isHero);

    const rows: string[] = [];
    for (let i = 0; i < top.length; i++) {
      const entry = top[i] as LeaderboardEntry;
      rows.push(this.renderRow(i + 1, entry));
    }

    if (!heroIncluded) {
      const heroEntry = payload.entries.find((e) => e.isHero);
      if (heroEntry) {
        rows.push(`<li class="hud-lb__sep" aria-hidden="true">…</li>`);
        rows.push(this.renderRow(payload.heroRank, heroEntry));
      }
    }

    this.leaderboardListEl.innerHTML = rows.join("");
  }

  private renderRow(rank: number, entry: LeaderboardEntry): string {
    const cls = [
      "hud-lb__row",
      entry.isHero ? "is-hero" : "",
      !entry.alive ? "is-dead" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const swatch = colorToHex(entry.color);
    const name = escapeHtml(entry.name);
    const pct = entry.percent.toFixed(1);
    return (
      `<li class="${cls}">` +
      `<span class="hud-lb__rank">${rank}</span>` +
      `<span class="hud-lb__swatch" style="background:${swatch}"></span>` +
      `<span class="hud-lb__name">${name}</span>` +
      `<span class="hud-lb__pct">${pct}%</span>` +
      `</li>`
    );
  }

  private onSplitCooldown(payload: CooldownUpdatePayload): void {
    const filled = RING_CIRC * payload.ratio;
    const offset = RING_CIRC - filled;
    this.splitRingEl.setAttribute("stroke-dashoffset", String(offset));

    if (payload.ready) {
      this.splitRingWrap.classList.add("ready");
      this.splitLabelEl.textContent = t("hud_split_ready");
    } else {
      this.splitRingWrap.classList.remove("ready");
      this.splitLabelEl.textContent = "";
    }
  }

  private onJoystickShow(payload: JoystickShowPayload): void {
    const r = this.stickBase.offsetWidth / 2;
    this.stickBase.style.left = `${payload.originX - r}px`;
    this.stickBase.style.top = `${payload.originY - r}px`;
    this.stickKnob.style.transform = "translate(-50%, -50%)";
    this.stickBase.classList.add("active");
  }

  private onJoystickMove(payload: JoystickMovePayload): void {
    const dx = payload.knobX - payload.originX;
    const dy = payload.knobY - payload.originY;
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private onJoystickHide(_payload: unknown): void {
    this.stickBase.classList.remove("active");
    this.stickKnob.style.transform = "translate(-50%, -50%)";
  }
}
