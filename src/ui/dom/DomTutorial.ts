import Phaser from "phaser";
import { GameEvents } from "@events/GameEvents";
import { t } from "./i18n";

type Step = "move" | "shoot";

const MOVE_DISTANCE_CELLS = 5;

export interface TutorialDeps {
  /** Returns hero world position in cells, or null if hero is not alive. */
  getHeroPos: () => { x: number; y: number } | null;
  onComplete: () => void;
}

export class DomTutorial {
  private root: HTMLElement;
  private msgEl!: HTMLElement;
  private iconEl!: HTMLElement;
  private tapHint: HTMLElement | null = null;
  private step: Step = "move";
  private mounted = false;
  private gameEvents: Phaser.Events.EventEmitter | null = null;
  private startPos: { x: number; y: number } | null = null;
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
      this.tickMovement();
    });
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
    const pos = this.deps.getHeroPos();
    if (pos) {
      if (!this.startPos) {
        this.startPos = { x: pos.x, y: pos.y };
      } else {
        const dx = pos.x - this.startPos.x;
        const dy = pos.y - this.startPos.y;
        if (Math.hypot(dx, dy) >= MOVE_DISTANCE_CELLS) {
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
