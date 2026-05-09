import { saves } from "@systems/SaveManager";
import type { SaveV1 } from "@/types/save";

/** Allowed UI-scale presets. Keep in sync with DomSettingsModal radio options. */
export const UI_SCALE_PRESETS = [0.85, 1.0, 1.15] as const;
export type UiScale = (typeof UI_SCALE_PRESETS)[number];

const MIN = 0.6;
const MAX = 1.6;

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(MAX, Math.max(MIN, v));
}

/** Push `--ui-scale` onto :root so HUD CSS picks it up via `zoom`. */
export function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty("--ui-scale", String(clamp(scale)));
}

/** Read current uiScale from save and apply. Safe to call before save is loaded — falls back to 1.0. */
export function applyStoredUiScale(): void {
  try {
    const s = saves.get<SaveV1>().settings as { uiScale?: number };
    applyUiScale(s.uiScale ?? 1.0);
  } catch {
    applyUiScale(1.0);
  }
}
