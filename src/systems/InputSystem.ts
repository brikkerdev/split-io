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

  // Native touch fallback state — used on iOS Safari when Phaser pointer
  // events aren't reliably delivered (Yandex iframe gesture arbiter, etc.).
  private nativeTouchDown = false;
  private nativeTouchX = 0;
  private nativeTouchY = 0;
  private nativeTouchStartMs = 0;
  private boundNativeStart?: (e: TouchEvent) => void;
  private boundNativeMove?: (e: TouchEvent) => void;
  private boundNativeEnd?: (e: TouchEvent) => void;

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

    this.installNativeTouchFallback();
  }

  /**
   * Attach native touch listeners directly to the canvas. Coordinates are
   * stored in canvas-local CSS pixels — same coordinate space Phaser uses
   * for pointer.x/y under the RESIZE scale mode. Both code paths run; the
   * stick-engagement code prefers Phaser's pointer when present and falls
   * back to native state when it isn't.
   */
  private installNativeTouchFallback(): void {
    const canvas = this.scene.game.canvas;
    if (!canvas) return;

    const toLocal = (t: Touch): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? canvas.width / rect.width : 1;
      const sy = rect.height > 0 ? canvas.height / rect.height : 1;
      return {
        x: (t.clientX - rect.left) * sx,
        y: (t.clientY - rect.top) * sy,
      };
    };

    this.boundNativeStart = (e: TouchEvent): void => {
      const t = e.changedTouches[0];
      if (!t) return;
      const p = toLocal(t);
      this.nativeTouchDown = true;
      this.nativeTouchX = p.x;
      this.nativeTouchY = p.y;
      this.nativeTouchStartMs = performance.now();
    };
    this.boundNativeMove = (e: TouchEvent): void => {
      if (!this.nativeTouchDown) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const p = toLocal(t);
      this.nativeTouchX = p.x;
      this.nativeTouchY = p.y;
    };
    this.boundNativeEnd = (_e: TouchEvent): void => {
      if (!this.nativeTouchDown) return;
      this.nativeTouchDown = false;
      // Mirror the Phaser pointerup path for tap-to-split + visual cleanup,
      // but only when Phaser hasn't already handled the release. Reading
      // activePointer.isDown lets us avoid double-firing on healthy devices.
      const phaserAlive = this.scene.input.activePointer.isDown;
      if (!phaserAlive && this.stickActive) {
        // Reuse the elapsed/drag tracked by handleTouchEnd via touchStartMs.
        if (this.touchStartMs === 0) this.touchStartMs = this.nativeTouchStartMs;
        this.handleTouchEnd(this.nativeTouchX, this.nativeTouchY);
      }
    };

    // passive:true — we never preventDefault; canvas already has
    // touch-action:none so iOS won't try to scroll/zoom on it.
    canvas.addEventListener("touchstart", this.boundNativeStart, { passive: true });
    canvas.addEventListener("touchmove", this.boundNativeMove, { passive: true });
    canvas.addEventListener("touchend", this.boundNativeEnd, { passive: true });
    canvas.addEventListener("touchcancel", this.boundNativeEnd, { passive: true });
  }

  /**
   * Detects a "stuck" stick — flag is true but the pointer that started it is
   * no longer physically down. Happens on Yandex iOS WebView when a touch
   * sequence is interrupted by `window.location.reload()` (settings reset),
   * tab visibility change, or the iframe consuming the touchend for its own
   * gesture handling. Without this, every subsequent pointerdown is ignored
   * because of the `if (this.stickActive) return` guards.
   */
  private clearStaleStick(): void {
    if (!this.stickActive) return;
    const existing = this.stickPointer;
    const phaserAlive = existing !== null && existing.isDown;
    // Native touch is a separate evidence source — treat the stick as live
    // while a finger is physically down even if Phaser hasn't refreshed yet.
    if (phaserAlive || this.nativeTouchDown) return;
    this.stickActive = false;
    this.stickPointer = null;
  }

  private onPointerDown(ptr: Phaser.Input.Pointer): void {
    this.clearStaleStick();

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
    // Swipe scheme on mobile (paper.io 2 style): touch anchor sets origin;
    // heading derives from finger offset relative to it. The anchor trails
    // the finger past `swipeAnchorRadiusPx` so long drags stay in reach.
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
    this.clearStaleStick();

    // Auto-engage on a finger that landed outside the canvas (DOM button) and
    // dragged in. See updateMobileSwipeHeading for the same fix.
    if (!this.stickActive) {
      const active = this.scene.input.activePointer;
      const isMobileTouch = this.isMobile && (active.isDown || this.nativeTouchDown);
      const isDesktopMouse = !this.isMobile && active.leftButtonDown();
      if (isMobileTouch || isDesktopMouse) {
        const phaserDown = active.isDown;
        const ox = phaserDown ? active.x : this.nativeTouchX;
        const oy = phaserDown ? active.y : this.nativeTouchY;
        this.stickActive = true;
        this.stickPointer = phaserDown ? active : null;
        this.stickOriginX = ox;
        this.stickOriginY = oy;
        this.touchStartMs = performance.now();
        this.touchMaxDrag = 0;
        this.scene.events.emit(JoystickEvents.Show, {
          originX: ox,
          originY: oy,
        } satisfies JoystickShowPayload);
      } else {
        return;
      }
    }

    // Read from the originating pointer so unrelated cursors/fingers can't
    // hijack the stick mid-drag. Fall back to native touch coords on iOS when
    // Phaser pointer events stop updating.
    const curPos = this.resolveCurrentTouch();
    const dx = curPos.x - this.stickOriginX;
    const dy = curPos.y - this.stickOriginY;
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
   * Mobile swipe (paper.io 2 style): heading = angle from the touch anchor to
   * the current finger position. The anchor is a virtual joystick centre that
   * trails the finger when the offset exceeds `swipeAnchorRadiusPx`, so the
   * finger never runs out of room during long drags. Tiny finger jitter no
   * longer flips the heading 180° because the angle is dominated by the
   * accumulated absolute offset, not per-frame deltas.
   */
  private updateMobileSwipeHeading(_dt: number): void {
    this.clearStaleStick();

    // Auto-engage when a finger is already down on the canvas but no stick is
    // active. This catches the common Yandex-mobile case where the player's
    // touch began on the DOM "Play" button (outside Phaser's hit region) and
    // dragged into the canvas without lifting — iOS does NOT emit a fresh
    // touchstart on the canvas, so our pointerdown handler never fires and
    // the entire first swipe was being lost.
    if (!this.stickActive) {
      const active = this.scene.input.activePointer;
      const phaserDown = active.isDown;
      if (phaserDown || this.nativeTouchDown) {
        this.stickActive = true;
        this.stickPointer = phaserDown ? active : null;
        this.stickOriginX = phaserDown ? active.x : this.nativeTouchX;
        this.stickOriginY = phaserDown ? active.y : this.nativeTouchY;
        this.touchStartMs = performance.now();
        this.touchMaxDrag = 0;
      } else {
        return;
      }
    }
    const curPos = this.resolveCurrentTouch();

    const dx = curPos.x - this.stickOriginX;
    const dy = curPos.y - this.stickOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this.touchMaxDrag) this.touchMaxDrag = dist;

    if (dist < INPUT.swipeDeadzonePixels) return;

    // Trailing anchor: once the finger pulls past the joystick radius, drag
    // the origin along so the finger stays at exactly `radius` away. This is
    // what lets paper.io 2 players hold a direction with a tiny finger swing
    // and re-aim by sliding without lifting.
    const radius = INPUT.swipeAnchorRadiusPx;
    if (dist > radius) {
      const k = (dist - radius) / dist;
      this.stickOriginX += dx * k;
      this.stickOriginY += dy * k;
    }

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

  /** Resolved current finger/cursor position, preferring Phaser when live. */
  private readonly _curPos = { x: 0, y: 0 };
  private resolveCurrentTouch(): { x: number; y: number } {
    const pinned = this.stickPointer;
    if (pinned !== null && pinned.isDown) {
      this._curPos.x = pinned.x;
      this._curPos.y = pinned.y;
      return this._curPos;
    }
    if (this.nativeTouchDown) {
      this._curPos.x = this.nativeTouchX;
      this._curPos.y = this.nativeTouchY;
      return this._curPos;
    }
    const active = this.scene.input.activePointer;
    this._curPos.x = active.x;
    this._curPos.y = active.y;
    return this._curPos;
  }

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
      this.updateMobileSwipeHeading(dt);
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
        // Released: optional inertia tail, then leave targetHeading where it
        // was. Paper.io 2 keeps the hero travelling in the last commanded
        // direction until a new tap. We deliberately do NOT reset target to
        // current — that would erase a swipe issued during spawn-grace (when
        // the hero is frozen) and leave the hero drifting in the default
        // heading once movement resumes.
        if (Math.abs(this.releaseAngularVel) > INPUT.rotationInertiaEpsilon) {
          this.targetHeading = normaliseAngle(
            this.targetHeading + this.releaseAngularVel * dtSec,
          );
          this.releaseAngularVel *= Math.pow(INPUT.rotationInertiaDecay, dtSec * 60);
        } else {
          this.releaseAngularVel = 0;
        }
      }
    }

    this.smoothHeading(dt);
  }

  private smoothHeading(dt: number): void {
    const dtSec = dt / 1000;
    const delta = shortestDelta(this.currentHeading, this.targetHeading);
    // Mobile (touch / floating stick) gets a softer turn-rate cap so the hero
    // arcs into a new heading like in paper.io 2 instead of snapping. Desktop
    // mouse aim stays effectively instant.
    const useMobileRate = this.isMobile || this.usesStick();
    const rate = useMobileRate ? INPUT.turnRateRadPerSecMobile : INPUT.turnRateRadPerSec;
    const maxStep = rate * dtSec;
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

  /** True if this device is using touch input (mobile). */
  isTouchDevice(): boolean {
    return this.isMobile;
  }

  /**
   * Clears the "first input received" flag. Called by HeroController on each
   * spawn so the intro-skip-on-input logic doesn't fire instantly on every
   * respawn just because the player swiped at some point earlier in the run.
   */
  resetInputFlag(): void {
    this.hasInput = false;
  }

  destroy(): void {
    this.scene.input.off(EV_POINTER_DOWN, this.boundPointerDown);
    this.scene.input.off(EV_POINTER_UP, this.boundPointerUp);
    this.scene.input.off("pointercancel", this.boundPointerCancel);
    this.spaceKey?.removeAllListeners();

    const canvas = this.scene.game.canvas;
    if (canvas) {
      if (this.boundNativeStart) canvas.removeEventListener("touchstart", this.boundNativeStart);
      if (this.boundNativeMove) canvas.removeEventListener("touchmove", this.boundNativeMove);
      if (this.boundNativeEnd) {
        canvas.removeEventListener("touchend", this.boundNativeEnd);
        canvas.removeEventListener("touchcancel", this.boundNativeEnd);
      }
    }
  }

  private emitSplit(): void {
    this.scene.events.emit(GameEvents.SplitRequest);
  }
}
