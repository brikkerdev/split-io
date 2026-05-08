import { SAVE_VERSION } from "@config/game";
import { yandex } from "@sdk/yandex";

export interface SaveData {
  version: number;
  [key: string]: unknown;
}

export class SaveManager {
  private cache: SaveData | null = null;
  private flushTimer: number | null = null;

  async load<T extends SaveData>(defaults: T): Promise<T> {
    const data = await yandex.load<T>();
    if (!data || data.version !== SAVE_VERSION) {
      this.cache = { ...defaults };
      return this.cache as T;
    }
    const merged = { ...defaults, ...data } as T;
    if (defaults.settings && typeof defaults.settings === "object") {
      const dSettings = defaults.settings as Record<string, unknown>;
      const fSettings = (data.settings as Record<string, unknown> | undefined) ?? {};
      (merged as Record<string, unknown>).settings = { ...dSettings, ...fSettings };
    }
    this.cache = merged;
    return merged;
  }

  get<T extends SaveData>(): T {
    if (!this.cache) throw new Error("Save not loaded");
    return this.cache as T;
  }

  patch(partial: Partial<SaveData>): void {
    if (!this.cache) throw new Error("Save not loaded");
    Object.assign(this.cache, partial);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 1000);
  }

  async flush(): Promise<void> {
    if (!this.cache) return;
    await yandex.save(this.cache);
  }
}

export const saves = new SaveManager();
