import Phaser from "phaser";
import { GameEvents } from "@events/GameEvents";
import { t } from "./i18n";

type Step = "move" | "shoot";

/** Cumulative absolute heading change required to advance, in radians (~140°). */
const TURN_TOTAL_RADIANS = 2.4;

export interface TutorialDeps {
  /** Returns hero heading in radians, or null if hero is not alive. */
  getHeroHeading: () => number | null;
  onComplete: () => void;
}

export class DomTutorial {
  private root: HTMLElement;
  private msgEl!: HTMLElement;
  private iconEl!: HTMLElement;
  private tapHint: HTMLElement | null = null;
  private fingerHint: HTMLElement | null = null;
  private step: Step = "move";
  private mounted = false;
  private gameEvents: Phaser.Events.EventEmitter | null = null;
  private lastHeading: number | null = null;
  private headingAccum = 0;
  private rafId = 0;
  private readonly deps: TutorialDeps;

  constructor(deps: TutorialDeps) {
    this.deps = deps;
    this.root = document.createElement("div");
    this.root.id = "tutorial-banner";
    this.root.className = "ui-screen tutorial-banner";
    this.build();
  }

  mount(gameEvents: Phaser.Events.EventEmitter): void {
    if (this.mounted) return;
    this.mounted = true;
    this.gameEvents = gameEvents;

    const overlay = document.getElementById("ui-overlay");
    overlay?.appendChild(this.root);

    this.gameEvents.on(GameEvents.GhostSpawned, this.onGhostSpawned, this);

    requestAnimationFrame(() => {
      this.root.classList.add("visible");
      this.spawnFingerHint();
      this.tickMovement();
    });
  }

  private isMobile(): boolean {
    return window.matchMedia?.("(pointer: coarse)").matches ?? false;
  }

  private spawnFingerHint(): void {
    if (!this.isMobile()) return;
    const overlay = document.getElementById("ui-overlay");
    if (!overlay) return;
    const hint = document.createElement("div");
    hint.className = "tutorial-finger-hint";
    hint.innerHTML = `
      <svg viewBox="0 0 240 120" class="tutorial-finger-hint__svg" aria-hidden="true">
        <path id="tut-inf-path" d="M40,60 C40,20 100,20 120,60 C140,100 200,100 200,60 C200,20 140,20 120,60 C100,100 40,100 40,60 Z"
              fill="none" stroke="rgba(30,30,30,0.35)" stroke-width="3" stroke-dasharray="6 6"/>
      </svg>
      <i class="ph-fill ph-hand-pointing tutorial-finger-hint__icon"></i>
    `;
    overlay.appendChild(hint);
    this.fingerHint = hint;
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.gameEvents) {
      this.gameEvents.off(GameEvents.GhostSpawned, this.onGhostSpawned, this);
      this.gameEvents = null;
    }
    this.root.classList.remove("visible");
    if (this.tapHint) {
      this.tapHint.remove();
      this.tapHint = null;
    }
    if (this.fingerHint) {
      this.fingerHint.remove();
      this.fingerHint = null;
    }
    setTimeout(() => this.root.remove(), 200);
  }

  private build(): void {
    const inner = document.createElement("div");
    inner.className = "tutorial-banner__inner";

    this.iconEl = document.createElement("i");
    this.iconEl.className = "ph ph-arrows-out-cardinal tutorial-banner__icon";

    this.msgEl = document.createElement("div");
    this.msgEl.className = "tutorial-banner__msg";
    this.msgEl.textContent = t("tutorial_move");

    inner.appendChild(this.iconEl);
    inner.appendChild(this.msgEl);
    this.root.appendChild(inner);
  }

  private tickMovement(): void {
    if (!this.mounted || this.step !== "move") return;
    const heading = this.deps.getHeroHeading();
    if (heading != null) {
      if (this.lastHeading == null) {
        this.lastHeading = heading;
      } else {
        let delta = heading - this.lastHeading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.headingAccum += Math.abs(delta);
        this.lastHeading = heading;
        if (this.headingAccum >= TURN_TOTAL_RADIANS) {
          this.advanceToShoot();
          return;
        }
      }
    }
    this.rafId = requestAnimationFrame(() => this.tickMovement());
  }

  private readonly onGhostSpawned = (): void => {
    this.finish();
  };

  private advanceToShoot(): void {
    this.step = "shoot";
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.root.classList.remove("visible");
    if (this.fingerHint) {
      this.fingerHint.remove();
      this.fingerHint = null;
    }
    setTimeout(() => {
      if (!this.mounted) return;
      this.msgEl.textContent = t("tutorial_shoot");
      this.iconEl.className = "ph ph-hand-tap tutorial-banner__icon";
      this.root.classList.add("visible");
      this.spawnTapHint();
    }, 180);
  }

  private spawnTapHint(): void {
    const overlay = document.getElementById("ui-overlay");
    if (!overlay) return;
    const hint = document.createElement("div");
    hint.className = "tutorial-tap-hint";
    hint.innerHTML = '<div class="tutorial-tap-hint__ring"></div><i class="ph-fill ph-hand-tap tutorial-tap-hint__icon"></i>';
    overlay.appendChild(hint);
    this.tapHint = hint;
  }

  private finish(): void {
    this.deps.onComplete();
    this.unmount();
  }
}
