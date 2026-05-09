declare module "rbush" {
  interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  class RBush<T extends BBox> {
    insert(item: T): this;
    remove(item: T, equals?: (a: T, b: T) => boolean): this;
    clear(): this;
    search(bbox: BBox): T[];
    collides(bbox: BBox): boolean;
    all(): T[];
    load(items: T[]): this;
  }

  export default RBush;
}
