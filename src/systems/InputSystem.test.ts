import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Minimal Phaser mocks (no Phaser import) ───────────────────────────────────

const mockSpaceKey = {
  on: vi.fn(),
  removeAllListeners: vi.fn(),
};

const mockKeyboard = {
  addKey: vi.fn().mockReturnValue(mockSpaceKey),
};

type EventHandler = (...args: unknown[]) => void;
const pointerListeners: Record<string, EventHandler[]> = {};

const mockInput = {
  on: vi.fn((event: string, handler: EventHandler) => {
    if (!pointerListeners[event]) pointerListeners[event] = [];
    pointerListeners[event].push(handler);
  }),
  off: vi.fn(),
  activePointer: { x: 0, y: 0, worldX: 0, worldY: 0, leftButtonDown: () => true },
  keyboard: mockKeyboard,
};

const mockEventBus: Record<string, EventHandler[]> = {};

const mockScene = {
  game: {
    device: {
      input: {
        touch: false, // desktop by default
      },
    },
  },
  cameras: {
    main: {
      width: 0,
      height: 0,
      zoom: 1,
      getWorldPoint: (x: number, y: number) => ({ x, y }),
    },
  },
  input: mockInput,
  events: {
    emit: vi.fn((event: string, ...args: unknown[]) => {
      (mockEventBus[event] ?? []).forEach((h) => h(...args));
    }),
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!mockEventBus[event]) mockEventBus[event] = [];
      mockEventBus[event].push(handler);
    }),
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

import { InputSystem } from "./InputSystem";

function firePointerDown(x: number, y: number, worldX = x, worldY = y): void {
  // Phaser passes the actual Pointer instance to handlers — its x/y mutate
  // with subsequent moves. We mirror that by passing activePointer itself.
  mockInput.activePointer.x = x;
  mockInput.activePointer.y = y;
  mockInput.activePointer.worldX = worldX;
  mockInput.activePointer.worldY = worldY;
  const handlers = pointerListeners["pointerdown"] ?? [];
  handlers.forEach((h) => h(mockInput.activePointer));
}

function firePointerMove(x: number, y: number, worldX = x, worldY = y): void {
  mockInput.activePointer.x = x;
  mockInput.activePointer.y = y;
  mockInput.activePointer.worldX = worldX;
  mockInput.activePointer.worldY = worldY;
}

function firePointerUp(): void {
  const handlers = pointerListeners["pointerup"] ?? [];
  handlers.forEach((h) => h(mockInput.activePointer));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(pointerListeners).forEach((k) => delete pointerListeners[k]);
  Object.keys(mockEventBus).forEach((k) => delete mockEventBus[k]);
  // Reset pointer
  mockInput.activePointer = {
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0,
    leftButtonDown: () => true,
  };
  mockScene.game.device.input.touch = false;
});

describe("InputSystem — desktop", () => {
  it("getDesiredHeading returns unit vector defaulting right (angle 0)", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();
    const h = sys.getDesiredHeading();
    expect(h.x).toBeCloseTo(1, 5);
    expect(h.y).toBeCloseTo(0, 5);
  });

  it("heading updates toward cursor right of hero", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    // cursor 100px to the right of hero at origin
    firePointerMove(100, 0, 100, 0);

    // advance 1000ms — plenty to snap fully
    sys.update(1000, 0, 0);

    const h = sys.getDesiredHeading();
    // heading should be right (cos≈1, sin≈0)
    expect(h.x).toBeCloseTo(1, 1);
    expect(Math.abs(h.y)).toBeLessThan(0.2);
  });

  it("heading updates toward cursor directly above hero", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    // cursor 100px up (negative y in screen space)
    firePointerMove(0, -100, 0, -100);
    // rawSmoothing needs multiple frames to converge fully; run 60 frames @16ms
    for (let i = 0; i < 60; i++) sys.update(16, 0, 0);

    const h = sys.getDesiredHeading();
    expect(Math.abs(h.x)).toBeLessThan(0.2);
    expect(h.y).toBeCloseTo(-1, 1);
  });

  it("heading ignores cursor inside deadzone", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    firePointerMove(2, 2, 2, 2); // within 8px deadzone
    sys.update(500, 0, 0);

    // should still be pointing right (initial)
    const h = sys.getDesiredHeading();
    expect(h.x).toBeCloseTo(1, 4);
  });

  it("emits split:request on pointer down", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    firePointerDown(50, 50, 50, 50);

    expect(mockScene.events.emit).toHaveBeenCalledWith("split:request");
  });

  it("heading snaps instantly to pointer direction", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    // cursor to the left => angle = PI
    firePointerMove(-100, 0, -100, 0);

    sys.update(16, 0, 0);

    const h = sys.getDesiredHeading();
    // instant response: hero faces left immediately
    expect(h.x).toBeLessThan(-0.99);
  });

  it("playerHasInput false initially, true after valid cursor move", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    expect(sys.playerHasInput()).toBe(false);

    // Move cursor to a direction clearly different from initial heading (0 = right)
    // 100px up-right, angle ≈ -PI/4 — well above hysteresisRad
    firePointerMove(100, -100, 100, -100);
    sys.update(16, 0, 0);

    expect(sys.playerHasInput()).toBe(true);
  });
});

describe("InputSystem — mobile swipe", () => {
  beforeEach(() => {
    mockScene.game.device.input.touch = true;
  });

  it("drag downward updates heading downward", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    // finger down at origin, then move downward (angle = PI/2)
    // This differs from initial heading (0 = right) by PI/2, well above hysteresis
    firePointerDown(0, 0);
    firePointerMove(0, 80); // 80px down — over swipe deadzone
    // run enough frames for rawSmoothing + turnRate to converge
    for (let i = 0; i < 60; i++) sys.update(16, 0, 0);

    const h = sys.getDesiredHeading();
    expect(h.y).toBeCloseTo(1, 1);
    expect(Math.abs(h.x)).toBeLessThan(0.2);
  });

  it("tap emits split:request", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    firePointerDown(50, 50);
    firePointerUp();

    expect(mockScene.events.emit).toHaveBeenCalledWith("split:request");
  });

  it("swipe within deadzone does not change heading", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    firePointerDown(0, 0);
    firePointerMove(5, 5); // within 12px swipe deadzone
    sys.update(500, 0, 0);

    // heading unchanged (still default right)
    const h = sys.getDesiredHeading();
    expect(h.x).toBeCloseTo(1, 4);
  });
});

describe("InputSystem — heading angle snapping", () => {
  it("converges to diagonal cursor direction over multiple frames", () => {
    const sys = new InputSystem(mockScene as never);
    sys.init();

    // 45° diagonal
    firePointerMove(100, 100, 100, 100);
    // rawSmoothing converges over ~60 frames; turnRate=6 handles the rest
    for (let i = 0; i < 60; i++) sys.update(16, 0, 0);

    const angle = sys.getHeadingAngle();
    // free-angle aim: should settle at PI/4 ≈ 0.785
    expect(angle).toBeCloseTo(Math.PI / 4, 1);
  });
});
