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

  /** Decaying angular velocity (rad/sec) carried briefly past release. */
  private releaseAngularVel = 0;

  /** True once the player provides first input. */
  private hasInput = false;

  /** Reused output object for getDesiredHeading — avoids per-frame allocation. */
  private readonly _headingOut: Vec2 = { x: 1, y: 0 };

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
  /**
   * The pointer that started the current stick interaction. We track it so
   * that secondary inputs (right-click, second touch finger, hover events
   * during gameplay animations) don't reset the stick origin or end it early.
   */
  private stickPointer: Phaser.Input.Pointer | null = null;

  /** Last knob position emitted via JoystickEvents.Move — skip re-emit if unchanged. */
  private lastEmittedKnobX = Number.NaN;
  private lastEmittedKnobY = Number.NaN;

  // Bound handlers (stored once so .off() can target them precisely instead of
  // wiping every listener registered for the event).
  private readonly boundPointerDown = (ptr: Phaser.Input.Pointer): void => this.onPointerDown(ptr);
  private readonly boundPointerUp = (ptr: Phaser.Input.Pointer): void => this.onPointerUp(ptr);
  private readonly boundPointerCancel = (ptr: Phaser.Input.Pointer): void => this.onPointerCancel(ptr);

  constructor(
    private readonly scene: Phaser.Scene,
    scheme: ControlScheme = "swipe",
  ) {
    this.isMobile = scene.game.device.input.touch;
    this.mobileMode = scheme === "joystick" ? "joystick" : "auto";
  }

  setScheme(s: ControlScheme): void {
    const next: MobileMode = s === "joystick" ? "joystick" : "auto";
    if (next === this.mobileMode) return;
    const wasStick = this.usesStick();
    this.mobileMode = next;
    // Switching out of joystick mode mid-drag: clear visuals.
    if (wasStick && !this.usesStick() && this.stickActive) {
      this.scene.events.emit(JoystickEvents.Hide, { x: 0, y: 0 });
    }
    // Always reset held-pointer state on scheme change to avoid stale input.
    this.stickActive = false;
    this.stickPointer = null;
  }

  /**
   * True when input should be driven by a floating stick (joystick scheme,
   * mobile or desktop). False = aim-with-pointer (cursor on desktop, finger
   * position vs hero on mobile, paper.io style).
   */
  private usesStick(): boolean {
    return this.mobileMode === "joystick";
  }

  init(): void {
    this.scene.input.on(EV_POINTER_DOWN, this.boundPointerDown);
    this.scene.input.on(EV_POINTER_UP, this.boundPointerUp);
    this.scene.input.on("pointercancel", this.boundPointerCancel);

    if (this.scene.input.keyboard) {
      this.spaceKey = this.scene.input.keyboard.addKey(KEYCODE_SPACE);
      this.spaceKey.on("down", () => {
        this.emitSplit();
      });
    }
  }

  private onPointerDown(ptr: Phaser.Input.Pointer): void {
    if (this.usesStick()) {
      // Already driving the stick with another pointer (e.g. left mouse held
      // and user right-clicks, or a second finger lands). Ignore — keep the
      // existing stick anchored where it was.
      if (this.stickActive) return;

      // Desktop joystick: only the primary button starts the stick. Right or
      // middle button down should not move the joystick.
      if (!this.isMobile && !ptr.leftButtonDown()) return;

      this.stickActive = true;
      this.stickPointer = ptr;
      this.stickOriginX = ptr.x;
      this.stickOriginY = ptr.y;
      this.touchStartMs = performance.now();
      this.touchMaxDrag = 0;
      this.scene.events.emit(JoystickEvents.Show, {
        originX: ptr.x,
        originY: ptr.y,
      } satisfies JoystickShowPayload);
      return;
    }
    // Swipe scheme on mobile: track held finger so update() can aim relative
    // to hero (paper.io style), and detect tap-to-split on release.
    if (this.isMobile) {
      if (this.stickActive) return;
      this.stickActive = true;
      this.stickPointer = ptr;
      this.stickOriginX = ptr.x;
      this.stickOriginY = ptr.y;
      this.touchStartMs = performance.now();
      this.touchMaxDrag = 0;
      return;
    }
    // Aim-with-cursor (desktop swipe scheme): left click splits immediately.
    if (ptr.leftButtonDown()) {
      this.emitSplit();
    }
  }

  private onPointerUp(ptr: Phaser.Input.Pointer): void {
    if (!this.stickActive) return;
    // Only the pointer that started the stick can end it. A right-mouse-up
    // while the left is still held must not hide the stick.
    if (this.stickPointer !== null && ptr !== this.stickPointer) return;
    this.handleTouchEnd(ptr.x, ptr.y);
  }

  private onPointerCancel(ptr: Phaser.Input.Pointer): void {
    if (!this.stickActive) return;
    if (this.stickPointer !== null && ptr !== this.stickPointer) return;
    this.handleTouchEnd(ptr.x, ptr.y);
  }

  private updateDesktopHeading(heroWorldX: number, heroWorldY: number): void {
    const ptr = this.scene.input.activePointer;
    const cam = this.scene.cameras.main;

    // Phaser only refreshes ptr.worldX/Y on pointer events. When the cursor is
    // stationary but the camera moves (hero crossing into/out of edge clamp),
    // the cached worldX/Y is stale and the heading drifts. Recompute every
    // frame from screen coords against the current camera.
    const world = cam.getWorldPoint(ptr.x, ptr.y);
    const dx = world.x - heroWorldX;
    const dy = world.y - heroWorldY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Deadzone is configured in screen pixels; convert to world units via zoom.
    const zoom = cam.zoom || 1;
    const deadzoneWorld = INPUT.deadzonePixels / zoom;
    if (dist < deadzoneWorld) return;

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

  // ── Floating stick (mobile touch + desktop joystick scheme) ───────────────

  private handleTouchEnd(x: number, y: number): void {
    if (!this.stickActive) return;
    this.stickActive = false;
    this.stickPointer = null;

    const elapsed = performance.now() - this.touchStartMs;
    const isDrag = this.touchMaxDrag >= INPUT.tapMaxDragPx;

    // Tap = short + no significant drag → split
    if (elapsed < INPUT.tapMaxMs && !isDrag) {
      this.emitSplit();
    }

    // Reset emit cache so the next stick session starts with a fresh write.
    this.lastEmittedKnobX = Number.NaN;
    this.lastEmittedKnobY = Number.NaN;

    // Only the joystick scheme has visuals to hide.
    if (this.usesStick()) {
      this.scene.events.emit(JoystickEvents.Hide, { x, y });
    }
  }

  private updateStickHeading(): void {
    if (!this.stickActive) return;

    // Read from the originating pointer so unrelated cursors/fingers can't
    // hijack the stick mid-drag. Fall back to activePointer if the reference
    // is missing (shouldn't happen in normal flow).
    const ptr = this.stickPointer ?? this.scene.input.activePointer;
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

    // Only emit when the knob actually moved — DomHUD then schedules a RAF to
    // write a CSS transform; emitting at 60Hz for a stationary finger means
    // a wasted RAF + style write every frame.
    if (knobX !== this.lastEmittedKnobX || knobY !== this.lastEmittedKnobY) {
      this.lastEmittedKnobX = knobX;
      this.lastEmittedKnobY = knobY;
      this.scene.events.emit(JoystickEvents.Move, {
        originX: this.stickOriginX,
        originY: this.stickOriginY,
        knobX,
        knobY,
      } satisfies JoystickMovePayload);
    }

    const raw = INPUT.snapToSteps ? snapToSteps(angle, INPUT.directionSteps) : angle;

    // Hysteresis
    const delta = Math.abs(normaliseAngle(raw - this.targetHeading));
    if (delta < INPUT.headingHysteresisRad) return;

    this.targetHeading = normaliseAngle(
      this.lerpAngle(this.targetHeading, raw, INPUT.rawSmoothingFactor),
    );
    this.hasInput = true;
  }

  /**
   * Mobile swipe scheme (paper.io 2 style): the heading is the angle from the
   * initial touch point to the current finger position. Circular finger motion
   * rotates the hero. The hero is NOT aimed at the finger's world position.
   */
  private updateMobileSwipeHeading(_heroWorldX: number, _heroWorldY: number): void {
    if (!this.stickActive) return;
    const ptr = this.stickPointer ?? this.scene.input.activePointer;

    const dx = ptr.x - this.stickOriginX;
    const dy = ptr.y - this.stickOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.touchMaxDrag) this.touchMaxDrag = dist;

    if (dist < INPUT.swipeDeadzonePixels) return;

    const raw = Math.atan2(dy, dx);
    const snapped = INPUT.snapToSteps ? snapToSteps(raw, INPUT.directionSteps) : raw;
    const delta = Math.abs(normaliseAngle(snapped - this.targetHeading));
    if (delta < INPUT.headingHysteresisRad) return;

    this.targetHeading = normaliseAngle(
      this.lerpAngle(this.targetHeading, snapped, INPUT.rawSmoothingFactor),
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
    const dtSec = dt / 1000;
    const headingBefore = this.targetHeading;
    const wasActive = this.stickActive;

    if (this.usesStick()) {
      this.updateStickHeading();
    } else if (this.isMobile) {
      this.updateMobileSwipeHeading(heroWorldX, heroWorldY);
    } else {
      this.updateDesktopHeading(heroWorldX, heroWorldY);
    }

    const touchScheme = this.usesStick() || this.isMobile;
    if (touchScheme) {
      if (wasActive && dtSec > 0) {
        // Sample angular velocity while input is active; carries past release.
        const inst = (shortestDelta(headingBefore, this.targetHeading) / dtSec) * INPUT.rotationInertiaScale;
        const max = INPUT.maxRotationInertiaRadPerSec;
        this.releaseAngularVel = Math.max(-max, Math.min(max, inst));
      } else if (!this.stickActive) {
        // Released: apply tiny inertia tail, then snap target to current to
        // halt rotation. Decay is frame-rate-independent.
        if (Math.abs(this.releaseAngularVel) > INPUT.rotationInertiaEpsilon) {
          this.targetHeading = normaliseAngle(
            this.targetHeading + this.releaseAngularVel * dtSec,
          );
          this.releaseAngularVel *= Math.pow(INPUT.rotationInertiaDecay, dtSec * 60);
        } else {
          this.releaseAngularVel = 0;
          this.targetHeading = this.currentHeading;
        }
      }
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

  /** Returns the heading unit vector. The same object is reused every call — do not store it. */
  getDesiredHeading(): Vec2 {
    this._headingOut.x = Math.cos(this.currentHeading);
    this._headingOut.y = Math.sin(this.currentHeading);
    return this._headingOut;
  }

  getHeadingAngle(): number {
    return this.currentHeading;
  }

  playerHasInput(): boolean {
    return this.hasInput;
  }

  destroy(): void {
    this.scene.input.off(EV_POINTER_DOWN, this.boundPointerDown);
    this.scene.input.off(EV_POINTER_UP, this.boundPointerUp);
    this.scene.input.off("pointercancel", this.boundPointerCancel);
    this.spaceKey?.removeAllListeners();
  }

  private emitSplit(): void {
    this.scene.events.emit(GameEvents.SplitRequest);
  }
}
