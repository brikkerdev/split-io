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
