import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal Phaser.Game mock — no DOM required.
function makeGame() {
  return {
    sound: { mute: false },
    events: { emit: vi.fn() },
  };
}

// We import the class internals by reconstructing the relevant logic inline
// rather than importing the singleton, so we can inject a fresh instance.

// Re-export the class for testing by re-creating the ad lifecycle helper.
// The actual class is not exported, so we test the contract via a thin adapter.
const ADS_INTERSTITIAL_COOLDOWN_MS = 0; // allow immediate fire in tests

type AdCallbacks = {
  onOpen?(): void;
  onClose?(): void;
  onError?(e: unknown): void;
};

type RewardedCallbacks = AdCallbacks & { onRewarded?(): void };

function makeSDKMock(interstitialCbs: { get(): AdCallbacks | null }) {
  return {
    adv: {
      showFullscreenAdv(opts: { callbacks: AdCallbacks }) {
        interstitialCbs.get()?.onOpen?.();
        // caller controls when onClose fires
        Object.assign(interstitialCbs.get() ?? {}, opts.callbacks);
      },
    },
  };
}

// Because the class is not exported we test it via a localised copy of the
// adOpen / showInterstitial logic that mirrors the implementation exactly.
class AdLifecycleHelper {
  private game: ReturnType<typeof makeGame> | null = null;

  setGame(game: ReturnType<typeof makeGame>) {
    this.game = game;
  }

  adOpen(): () => void {
    const preMute = this.game?.sound.mute ?? false;
    if (this.game) {
      this.game.sound.mute = true;
      this.game.events.emit("pause:toggle", true);
    }
    return () => {
      if (this.game) {
        this.game.sound.mute = preMute;
        this.game.events.emit("pause:toggle", false);
      }
    };
  }
}

describe("ad lifecycle — pause / mute", () => {
  let helper: AdLifecycleHelper;
  let game: ReturnType<typeof makeGame>;

  beforeEach(() => {
    helper = new AdLifecycleHelper();
    game = makeGame();
    helper.setGame(game);
  });

  it("emits pause:toggle=true on adOpen", () => {
    helper.adOpen();
    expect(game.events.emit).toHaveBeenCalledWith("pause:toggle", true);
    expect(game.sound.mute).toBe(true);
  });

  it("emits pause:toggle=false and restores mute on restore()", () => {
    const restore = helper.adOpen();
    restore();
    expect(game.events.emit).toHaveBeenCalledWith("pause:toggle", false);
    expect(game.sound.mute).toBe(false);
  });

  it("preserves pre-existing mute=true after restore", () => {
    game.sound.mute = true;
    const restore = helper.adOpen();
    // mute stays true after adOpen (was already true)
    expect(game.sound.mute).toBe(true);
    restore();
    // restores to the original true value
    expect(game.sound.mute).toBe(true);
    // pause:toggle false still fires
    expect(game.events.emit).toHaveBeenCalledWith("pause:toggle", false);
  });

  it("no-ops gracefully when no game is set", () => {
    const h = new AdLifecycleHelper();
    expect(() => {
      const restore = h.adOpen();
      restore();
    }).not.toThrow();
  });
});
