const MIN = 0.6;
const MAX = 1.6;

/**
 * Platform-aware UI scale. Mobile (coarse pointer) gets a small preset because
 * HUD elements are already huge relative to a phone screen; desktop gets a
 * larger preset so the HUD reads comfortably from typical viewing distance.
 * No user-facing toggle — the value is fixed per platform.
 */
export function getDefaultUiScale(): number {
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    return coarse ? 0.85 : 1.15;
  } catch {
    return 1.0;
  }
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(MAX, Math.max(MIN, v));
}

/** Push `--ui-scale` onto :root so HUD CSS picks it up via `zoom`. */
export function applyUiScale(scale: number): void {
  document.documentElement.style.setProperty("--ui-scale", String(clamp(scale)));
}

/** Apply the platform-appropriate UI scale. Stored save values are ignored. */
export function applyStoredUiScale(): void {
  applyUiScale(getDefaultUiScale());
}
