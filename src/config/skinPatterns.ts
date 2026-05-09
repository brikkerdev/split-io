// Procedural patterns applied on top of a skin's base fill colour.
// Used both for the skins gallery (CSS background) and for in-game
// territory overlay (procedural texture generated via Canvas2D).

export type PatternId =
  | "solid"
  | "stripes"
  | "dots"
  | "checker"
  | "grid"
  | "waves"
  | "diamond"
  | "zigzag"
  | "scales"
  | "plaid"
  | "hex"
  | "circuit"
  | "stars"
  | "noise"
  | "rays"
  | "weave"
  | "duo"
  | "duo_diag"
  | "duo_split";

const TILE = 32;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

function shade(c: number, amt: number): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  const f = (v: number): number => {
    if (amt >= 0) return Math.round(v + (255 - v) * amt);
    return Math.round(v * (1 + amt));
  };
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * Return a CSS `background` value rendering this pattern at given fill.
 * If `secondary` is provided, it replaces the auto-shaded "dark" accent —
 * this is how dual-tone skins get their second colour into the pattern.
 */
export function patternCss(id: PatternId, fill: number, secondary?: number): string {
  const base = hex(fill);
  const dark = hex(secondary ?? shade(fill, -0.32));
  const light = hex(shade(fill, 0.28));

  switch (id) {
    case "solid":
      return base;
    case "stripes":
      return `repeating-linear-gradient(45deg, ${base} 0 6px, ${dark} 6px 12px)`;
    case "dots":
      return `radial-gradient(${dark} 22%, transparent 24%) 0 0/8px 8px, ${base}`;
    case "checker":
      return `conic-gradient(${dark} 0 25%, ${base} 0 50%, ${dark} 0 75%, ${base} 0) 0 0/10px 10px, ${base}`;
    case "grid":
      return `linear-gradient(${dark} 1.5px, transparent 1.5px) 0 0/8px 8px, linear-gradient(90deg, ${dark} 1.5px, transparent 1.5px) 0 0/8px 8px, ${base}`;
    case "waves":
      return `repeating-radial-gradient(circle at 50% 100%, ${dark} 0 2px, transparent 2px 8px), ${base}`;
    case "diamond":
      return `repeating-linear-gradient(45deg, ${dark} 0 1.5px, transparent 1.5px 8px), repeating-linear-gradient(-45deg, ${dark} 0 1.5px, transparent 1.5px 8px), ${base}`;
    case "zigzag": {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'><path d='M0 7 L4 1 L8 7 L12 1 L16 7' stroke='${dark}' stroke-width='1.2' fill='none' stroke-linejoin='miter'/></svg>`;
      return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 0 0/16px 8px, ${base}`;
    }
    case "scales":
      return `radial-gradient(circle at 50% 0%, transparent 6px, ${dark} 6px 7px, transparent 7px) 0 0/12px 8px, radial-gradient(circle at 50% 100%, transparent 6px, ${dark} 6px 7px, transparent 7px) 6px 4px/12px 8px, ${base}`;
    case "plaid":
      return `repeating-linear-gradient(0deg, ${dark}66 0 2px, transparent 2px 10px), repeating-linear-gradient(90deg, ${dark}66 0 2px, transparent 2px 10px), ${base}`;
    case "hex":
      return `radial-gradient(circle at 50% 50%, ${dark} 1.4px, transparent 1.5px) 0 0/10px 10px, ${base}`;
    case "circuit":
      return `linear-gradient(${dark} 1px, transparent 1px) 0 0/12px 12px, linear-gradient(90deg, ${dark} 1px, transparent 1px) 6px 6px/12px 12px, ${base}`;
    case "stars":
      return `radial-gradient(circle at 25% 25%, ${light} 1px, transparent 1.5px) 0 0/12px 12px, radial-gradient(circle at 75% 75%, ${light} 0.8px, transparent 1.2px) 0 0/12px 12px, ${base}`;
    case "noise":
      return `radial-gradient(circle at 30% 40%, ${light} 0.8px, transparent 1px) 0 0/6px 6px, radial-gradient(circle at 70% 60%, ${dark} 0.8px, transparent 1px) 0 0/6px 6px, ${base}`;
    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% 50%, ${base} 0 12deg, ${dark} 12deg 24deg)`;
    case "weave":
      return `repeating-linear-gradient(90deg, ${dark}55 0 4px, ${light}33 4px 8px), repeating-linear-gradient(0deg, ${dark}55 0 4px, transparent 4px 8px), ${base}`;
    case "duo":
      return `linear-gradient(180deg, ${base} 50%, ${dark} 50%)`;
    case "duo_diag":
      return `linear-gradient(135deg, ${base} 50%, ${dark} 50%)`;
    case "duo_split":
      return `linear-gradient(90deg, ${base} 0 33%, ${dark} 33% 66%, ${base} 66% 100%)`;
  }
}

/**
 * Render the pattern into a 32×32 ImageData using the given fill color.
 * Used to bake Phaser textures for in-game overlay.
 * `secondary` (optional) overrides the auto-shaded dark accent — used by
 * two-tone skins.
 */
export function rasterPattern(
  id: PatternId,
  fill: number,
  secondary?: number,
): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = TILE;
  cv.height = TILE;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;

  const base = hex(fill);
  const dark = hex(secondary ?? shade(fill, -0.32));
  const light = hex(shade(fill, 0.28));

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);

  ctx.fillStyle = dark;
  ctx.strokeStyle = dark;

  switch (id) {
    case "solid":
      break;
    case "stripes": {
      ctx.save();
      ctx.translate(TILE / 2, TILE / 2);
      ctx.rotate(Math.PI / 4);
      for (let i = -TILE; i < TILE; i += 12) {
        ctx.fillRect(i, -TILE, 6, TILE * 2);
      }
      ctx.restore();
      break;
    }
    case "dots": {
      for (let y = 0; y < TILE; y += 8) {
        for (let x = 0; x < TILE; x += 8) {
          ctx.beginPath();
          ctx.arc(x + 4, y + 4, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "checker": {
      const s = 8;
      for (let y = 0; y < TILE; y += s) {
        for (let x = 0; x < TILE; x += s) {
          if (((x / s) + (y / s)) % 2 === 0) ctx.fillRect(x, y, s, s);
        }
      }
      break;
    }
    case "grid": {
      ctx.lineWidth = 1.2;
      for (let i = 0; i <= TILE; i += 8) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TILE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(TILE, i); ctx.stroke();
      }
      break;
    }
    case "waves": {
      ctx.lineWidth = 1.4;
      for (let yy = 0; yy < TILE + 8; yy += 6) {
        ctx.beginPath();
        for (let xx = 0; xx <= TILE; xx += 2) {
          const y = yy + Math.sin(xx * 0.4) * 1.6;
          if (xx === 0) ctx.moveTo(xx, y);
          else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "diamond": {
      ctx.lineWidth = 1;
      for (let i = -TILE; i < TILE * 2; i += 8) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + TILE, TILE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, TILE); ctx.lineTo(i + TILE, 0); ctx.stroke();
      }
      break;
    }
    case "zigzag": {
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = "miter";
      const step = 8;
      const amp = 6;
      for (let yy = -amp; yy < TILE + amp; yy += amp) {
        ctx.beginPath();
        for (let xx = 0; xx <= TILE + step; xx += step) {
          const y = yy + ((xx / step) % 2 ? amp : 0);
          if (xx === 0) ctx.moveTo(xx, y);
          else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "scales": {
      ctx.lineWidth = 1.2;
      const r = 6;
      for (let yy = -r; yy < TILE + r; yy += r) {
        for (let xx = -r; xx < TILE + r * 2; xx += r * 2) {
          ctx.beginPath();
          ctx.arc(xx, yy, r, 0, Math.PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(xx + r, yy + r / 2, r, 0, Math.PI);
          ctx.stroke();
        }
      }
      break;
    }
    case "plaid": {
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < TILE; i += 10) ctx.fillRect(i, 0, 2, TILE);
      for (let i = 0; i < TILE; i += 10) ctx.fillRect(0, i, TILE, 2);
      ctx.globalAlpha = 1;
      break;
    }
    case "hex": {
      const stagger = 5;
      for (let y = 0; y < TILE; y += stagger) {
        for (let x = 0; x < TILE; x += 10) {
          const ox = (y / stagger) % 2 ? 5 : 0;
          ctx.beginPath();
          ctx.arc(x + ox, y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "circuit": {
      ctx.lineWidth = 1;
      ctx.strokeStyle = dark;
      for (let i = 0; i <= TILE; i += 12) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TILE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i + 6); ctx.lineTo(TILE, i + 6); ctx.stroke();
      }
      ctx.fillStyle = dark;
      for (let y = 0; y < TILE; y += 12) {
        for (let x = 6; x < TILE; x += 12) {
          ctx.beginPath();
          ctx.arc(x, y + 6, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "stars": {
      ctx.fillStyle = light;
      const pts = [
        [4, 4, 1.4], [10, 14, 0.9], [18, 6, 1.1],
        [24, 22, 1.3], [6, 24, 1.0], [28, 12, 0.9],
      ];
      for (const [x, y, r] of pts) {
        ctx.beginPath();
        ctx.arc(x as number, y as number, r as number, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "noise": {
      const img = ctx.getImageData(0, 0, TILE, TILE);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const j = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const n = (j < 0 ? j + 1 : j) - 0.5;
        data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n * 36));
        data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n * 36));
        data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + n * 36));
      }
      ctx.putImageData(img, 0, 0);
      break;
    }
    case "rays": {
      ctx.save();
      ctx.translate(TILE / 2, TILE / 2);
      const slices = 12;
      for (let i = 0; i < slices; i++) {
        if (i % 2 === 0) continue;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, TILE, (i / slices) * Math.PI * 2, ((i + 1) / slices) * Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "weave": {
      ctx.fillStyle = dark;
      for (let i = 0; i < TILE; i += 8) ctx.fillRect(i, 0, 4, TILE);
      ctx.fillStyle = light;
      for (let i = 4; i < TILE; i += 8) ctx.fillRect(0, i, TILE, 4);
      break;
    }
    case "duo": {
      ctx.fillStyle = dark;
      ctx.fillRect(0, TILE / 2, TILE, TILE / 2);
      break;
    }
    case "duo_diag": {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(0, TILE);
      ctx.lineTo(TILE, 0);
      ctx.lineTo(TILE, TILE);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "duo_split": {
      ctx.fillStyle = dark;
      ctx.fillRect(Math.floor(TILE / 3), 0, Math.ceil(TILE / 3), TILE);
      break;
    }
  }
  return cv;
}

export const PATTERN_TILE_PX = TILE;
