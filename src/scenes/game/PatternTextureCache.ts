import type Phaser from "phaser";
import { rasterPattern, type PatternId } from "@config/skinPatterns";
import type { SkinDef } from "@config/skins";

// Max textures baked synchronously in the first frame.
// Anything beyond this is deferred in 50ms batches so it doesn't block frame 0.
const SYNC_BATCH_SIZE = 16;
// How many textures per deferred batch tick.
const DEFERRED_BATCH_SIZE = 8;

/**
 * Lazily-initialised Phaser canvas-texture cache, keyed by (pattern, fill).
 * One Phaser texture per (pattern, color) is generated on first request and
 * reused for the lifetime of the scene.
 */
export class PatternTextureCache {
  private known = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Pre-bake textures for every (pattern, fill, fillSecondary) tuple in the
   * given skin list. Skips solid skins — they don't need overlay textures.
   *
   * The first SYNC_BATCH_SIZE textures are baked synchronously so they are
   * ready before the first gameplay frame. Remaining ones are scheduled in
   * DEFERRED_BATCH_SIZE-sized ticks every 50ms so Canvas2D + WebGL upload
   * cost is spread across pre-game idle time instead of spiking frame 0.
   */
  warmup(skins: readonly SkinDef[]): void {
    const nonSolid = skins.filter((s) => s.pattern !== "solid");
    const sync = nonSolid.slice(0, SYNC_BATCH_SIZE);
    const deferred = nonSolid.slice(SYNC_BATCH_SIZE);

    for (const s of sync) {
      this.ensure(s.pattern, s.fill, s.fillSecondary);
    }

    if (deferred.length === 0) return;

    const bakeChunk = (offset: number): void => {
      const chunk = deferred.slice(offset, offset + DEFERRED_BATCH_SIZE);
      for (const s of chunk) {
        this.ensure(s.pattern, s.fill, s.fillSecondary);
      }
      const next = offset + DEFERRED_BATCH_SIZE;
      if (next < deferred.length) {
        this.scene.time.delayedCall(50, () => bakeChunk(next));
      }
    };

    this.scene.time.delayedCall(50, () => bakeChunk(0));
  }

  ensure(id: PatternId, fill: number, secondary?: number): string {
    const sKey = secondary !== undefined ? secondary.toString(16).padStart(6, "0") : "x";
    const key = `pattern_${id}_${fill.toString(16).padStart(6, "0")}_${sKey}`;
    if (this.known.has(key)) return key;
    if (this.scene.textures.exists(key)) {
      this.known.add(key);
      return key;
    }
    const cv = rasterPattern(id, fill, secondary);
    this.scene.textures.addCanvas(key, cv);
    this.known.add(key);
    return key;
  }
}
