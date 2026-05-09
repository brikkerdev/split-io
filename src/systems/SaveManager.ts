import { SAVE_VERSION } from "@config/game";
import { yandex } from "@sdk/yandex";

export interface SaveData {
  version: number;
  [key: string]: unknown;
}

type NestedRecord = Record<string, unknown>;

function deepMergeInto(target: NestedRecord, source: NestedRecord): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      deepMergeInto(tv as NestedRecord, sv as NestedRecord);
    } else {
      target[key] = sv;
    }
  }
}

export class SaveManager {
  private cache: SaveData | null = null;
  private flushTimer: number | null = null;
  private pendingPatch: Partial<SaveData> = {};
  private visibilityListenerAttached = false;

  async load<T extends SaveData>(defaults: T): Promise<T> {
    const data = await yandex.load<T>();
    if (!data || data.version !== SAVE_VERSION) {
      this.cache = { ...defaults };
      this.attachVisibilityListener();
      return this.cache as T;
    }
    const merged = { ...defaults, ...data } as T;
    if (defaults.settings && typeof defaults.settings === "object") {
      const dSettings = defaults.settings as Record<string, unknown>;
      const fSettings = (data.settings as Record<string, unknown> | undefined) ?? {};
      (merged as Record<string, unknown>).settings = { ...dSettings, ...fSettings };
    }
    this.cache = merged;
    this.attachVisibilityListener();
    return merged;
  }

  get<T extends SaveData>(): T {
    if (!this.cache) throw new Error("Save not loaded");
    return this.cache as T;
  }

  patch(partial: Partial<SaveData>): void {
    if (!this.cache) throw new Error("Save not loaded");
    // Apply to live cache immediately (deep for nested objects).
    deepMergeInto(this.cache as NestedRecord, partial as NestedRecord);
    // Accumulate into pending patch for batched flush.
    deepMergeInto(this.pendingPatch as NestedRecord, partial as NestedRecord);
    this.scheduleFlush();
  }

  /** Replace the entire save with `defaults` (used by reset progress). */
  resetTo<T extends SaveData>(defaults: T): T {
    this.cache = { ...defaults };
    this.pendingPatch = { ...defaults };
    this.scheduleFlush();
    return this.cache as T;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 1500);
  }

  private attachVisibilityListener(): void {
    if (this.visibilityListenerAttached) return;
    this.visibilityListenerAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        // Flush immediately so data isn't lost when the tab closes.
        if (this.flushTimer !== null) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }
        if (Object.keys(this.pendingPatch).length > 0) {
          void this.flush();
        }
      }
      // On 'visible': if there's a pending patch, re-arm the debounce.
      // (patch() sets pendingPatch and calls scheduleFlush, so nothing to do here
      // unless a patch arrived while hidden and the timer was cleared.)
    });
  }

  async flush(): Promise<void> {
    if (!this.cache) return;
    this.pendingPatch = {};
    await yandex.save(this.cache);
  }
}

export const saves = new SaveManager();
