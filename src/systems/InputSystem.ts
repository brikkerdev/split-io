import type Phaser from "phaser";
import { GameEvents } from "@events/GameEvents";
import { INPUT } from "@config/input";
import type { Vec2 } from "@gametypes/geometry";

const EV_POINTER_DOWN = "pointerdown";
const EV_POINTER_UP = "pointerup";
const KEYCODE_SPACE = 32;

/** Events emitted to scene.events for joystick visuals in DomHUD. */
export const JoystickEvents = {
  Show: "joystick:show",
  Move: "joystick:move",
  Hide: "joystick:hide",
} as const;

export interface JoystickShowPayload {
  originX: number;
  originY: number;
}

export interface JoystickMovePayload {
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
}

/** Normalises an angle to [-PI, PI]. */
function normaliseAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Shortest angular delta from `current` to `target`. */
function shortestDelta(current: number, target: number): number {
  return normaliseAngle(target - current);
}

function snapToSteps(angle: number, steps: number): number {
  const step = (Math.PI * 2) / steps;
  return Math.round(angle / step) * step;
}

export type ControlScheme = "swipe" | "joystick";
export type MobileMode = "auto" | "joystick";

export class InputSystem {
  /** Current smoothed heading in radians (0 = right, CCW positive). */
  private currentHeading = 0;

  /** Desired heading after hysteresis + raw smoothing. Smoothing target for turn-rate. */
  private targetHeading = 0;

  /** True once the player provides first input. */
  private hasInput = false;

  private readonly isMobile: boolean;
  private mobileMode: MobileMode = "auto";

  // Keyboard
  private spaceKey: Phaser.Input.Keyboard.Key | null = null;

  // Floating stick state
  private stickActive = false;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private touchStartMs = 0;
  private touchMaxDrag = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    scheme: ControlScheme = "swipe",
  ) {
    this.isMobile = scene.game.device.input.touch;
    this.mobileMode = scheme === "joystick" ? "joystick" : "auto";
  }

  setScheme(s: ControlScheme): void {
    this.mobileMode = s === "joystick" ? "joystick" : "auto";
  }

  init(): void {
    if (!this.isMobile) {
      this.initDesktop();
    } else {
      this.initMobile();
    }
  }

  // ── Desktop ────────────────────────────────────────────────────────────────

  private initDesktop(): void {
    this.scene.input.on(
      EV_POINTER_DOWN,
      (ptr: Phaser.Input.Pointer) => {
        if (ptr.leftButtonDown()) {
          this.emitSplit();
        }
      },
    );

    if (this.scene.input.keyboard) {
      this.spaceKey = this.scene.input.keyboard.addKey(KEYCODE_SPACE);
      this.spaceKey.on("down", () => {
        this.emitSplit();
      });
    }
  }

  private updateDesktopHeading(_heroWorldX: number, _heroWorldY: number): void {
    const ptr = this.scene.input.activePointer;
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    const dx = ptr.x - cx;
    const dy = ptr.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < INPUT.deadzonePixels) return;

    const raw = Math.atan2(dy, dx);
    const snapped = INPUT.snapToSteps ? snapToSteps(raw, INPUT.directionSteps) : raw;

    // Hysteresis: ignore tiny deltas
    const delta = Math.abs(normaliseAngle(snapped - this.targetHeading));
    if (delta < INPUT.headingHysteresisRad) return;

    // Exponential smoothing on raw input
    this.targetHeading = normaliseAngle(
      this.lerpAngle(this.targetHeading, snapped, INPUT.rawSmoothingFactor),
    );
    this.hasInput = true;
  }

  // ── Mobile floating stick ──────────────────────────────────────────────────

  private initMobile(): void {
    this.scene.input.on(
      EV_POINTER_DOWN,
      (ptr: Phaser.Input.Pointer) => {
        this.stickActive = true;
        this.stickOriginX = ptr.x;
        this.stickOriginY = ptr.y;
        this.touchStartMs = Date.now();
        this.touchMaxDrag = 0;

        this.scene.events.emit(JoystickEvents.Show, {
          originX: ptr.x,
          originY: ptr.y,
        } satisfies JoystickShowPayload);
      },
    );

    this.scene.input.on(
      EV_POINTER_UP,
      (ptr: Phaser.Input.Pointer) => {
        this.handleTouchEnd(ptr.x, ptr.y);
      },
    );

    // touchcancel maps to pointercancel in Phaser
    this.scene.input.on(
      "pointercancel",
      (ptr: Phaser.Input.Pointer) => {
        this.handleTouchEnd(ptr.x, ptr.y);
      },
    );
  }

  private handleTouchEnd(x: number, y: number): void {
    if (!this.stickActive) return;
    this.stickActive = false;

    const elapsed = Date.now() - this.touchStartMs;
    const isDrag = this.touchMaxDrag >= INPUT.tapMaxDragPx;

    // Tap = short + no significant drag → split
    if (elapsed < INPUT.tapMaxMs && !isDrag) {
      this.emitSplit();
    }

    this.scene.events.emit(JoystickEvents.Hide, { x, y });
  }

  private updateMobileHeading(): void {
    if (!this.stickActive) return;

    const ptr = this.scene.input.activePointer;
    const dx = ptr.x - this.stickOriginX;
    const dy = ptr.y - this.stickOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Track max drag for tap detection
    if (dist > this.touchMaxDrag) {
      this.touchMaxDrag = dist;
    }

    if (dist < INPUT.swipeDeadzonePixels) return;

    // Clamp knob to stick radius
    const clampedDist = Math.min(dist, INPUT.stickRadiusPx);
    const angle = Math.atan2(dy, dx);
    const knobX = this.stickOriginX + Math.cos(angle) * clampedDist;
    const knobY = this.stickOriginY + Math.sin(angle) * clampedDist;

    this.scene.events.emit(JoystickEvents.Move, {
      originX: this.stickOriginX,
      originY: this.stickOriginY,
      knobX,
      knobY,
    } satisfies JoystickMovePayload);

    const raw = INPUT.snapToSteps ? snapToSteps(angle, INPUT.directionSteps) : angle;

    // Hysteresis
    const delta = Math.abs(normaliseAngle(raw - this.targetHeading));
    if (delta < INPUT.headingHysteresisRad) return;

    this.targetHeading = normaliseAngle(
      this.lerpAngle(this.targetHeading, raw, INPUT.rawSmoothingFactor),
    );
    this.hasInput = true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Lerps between two angles taking the shortest arc.
   */
  private lerpAngle(from: number, to: number, t: number): number {
    const delta = normaliseAngle(to - from);
    return from + delta * t;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  update(dt: number, heroWorldX: number, heroWorldY: number): void {
    if (!this.isMobile) {
      this.updateDesktopHeading(heroWorldX, heroWorldY);
    } else {
      this.updateMobileHeading();
    }
    this.smoothHeading(dt);
  }

  private smoothHeading(dt: number): void {
    const dtSec = dt / 1000;
    const delta = shortestDelta(this.currentHeading, this.targetHeading);
    const maxStep = INPUT.turnRateRadPerSec * dtSec;
    const step = Math.max(-maxStep, Math.min(maxStep, delta));
    this.currentHeading = normaliseAngle(this.currentHeading + step);
  }

  getDesiredHeading(): Vec2 {
    return {
      x: Math.cos(this.currentHeading),
      y: Math.sin(this.currentHeading),
    };
  }

  getHeadingAngle(): number {
    return this.currentHeading;
  }

  playerHasInput(): boolean {
    return this.hasInput;
  }

  destroy(): void {
    this.scene.input.off(EV_POINTER_DOWN);
    this.scene.input.off(EV_POINTER_UP);
    this.scene.input.off("pointercancel");
    this.spaceKey?.removeAllListeners();
  }

  private emitSplit(): void {
    this.scene.events.emit(GameEvents.SplitRequest);
  }
}
