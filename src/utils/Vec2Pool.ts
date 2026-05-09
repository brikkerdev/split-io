import type { Vec2 } from "@gametypes/geometry";

/**
 * Lightweight object pool for Vec2 {x,y} instances.
 * Avoids per-frame heap allocation in posHistory hot paths.
 */
export class Vec2Pool {
  private readonly pool: Vec2[] = [];

  acquire(x: number, y: number): Vec2 {
    const obj = this.pool.pop();
    if (obj !== undefined) {
      obj.x = x;
      obj.y = y;
      return obj;
    }
    return { x, y };
  }

  release(obj: Vec2): void {
    this.pool.push(obj);
  }

  releaseAll(arr: Vec2[]): void {
    for (let i = 0; i < arr.length; i++) {
      this.pool.push(arr[i] as Vec2);
    }
  }
}
