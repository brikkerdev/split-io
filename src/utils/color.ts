/** Lighten (amount > 0) or darken (amount < 0) a 0xRRGGBB color. amount in [-1, 1]. */
export function shadeColor(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const adjust = (c: number): number => {
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
}

/**
 * Desaturate a 0xRRGGBB color toward its luminance grey.
 * amount in [0, 1]: 0 = unchanged, 1 = fully grey.
 */
export function desaturateColor(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = Math.max(0, Math.min(1, amount));
  const mix = (c: number): number =>
    Math.max(0, Math.min(255, Math.round(c + (lum - c) * k)));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
