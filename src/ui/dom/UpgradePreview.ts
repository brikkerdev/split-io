import type { UpgradeId } from "@config/upgrades";

const CYAN = "#00f5ff";
const DIM = "rgba(255,255,255,0.22)";

const BG_FILL = "rgba(20, 22, 34, 0.92)";
const BG_BORDER = "rgba(42, 42, 46, 0.85)";
const GRID = "rgba(255,255,255,0.07)";
const GRID_STEP = 16;
const BG_RADIUS = 14;
const BG_PAD = 6;

type DrawFn = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;

/** Canvas-based looping demo preview for each upgrade. No Phaser dependency. */
export class UpgradePreview {
  private rafId = 0;
  private canvas: HTMLCanvasElement | null = null;
  private startTime = 0;

  mount(canvas: HTMLCanvasElement, id: UpgradeId): void {
    this.unmount();
    this.canvas = canvas;
    this.startTime = performance.now();

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = this.getDrawFn(id);

    const loop = (): void => {
      const elapsed = (performance.now() - this.startTime) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drawBackground(ctx, canvas.width, canvas.height);
      draw(ctx, elapsed % 3, canvas.width, canvas.height);
      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  unmount(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.canvas = null;
  }

  private getDrawFn(id: UpgradeId): DrawFn {
    switch (id) {
      case "ghostSpeed":    return this.drawGhostSpeed.bind(this);
      case "ghostLifetime": return this.drawGhostLifetime.bind(this);
      case "ghostCooldown": return this.drawGhostCooldown.bind(this);
      case "passiveSpeed":  return this.drawPassiveSpeed.bind(this);
    }
  }

  // ── Background (rounded rect + grid) ───────────────────────

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const x = BG_PAD;
    const y = BG_PAD;
    const rw = w - BG_PAD * 2;
    const rh = h - BG_PAD * 2;

    ctx.save();

    // Filled rounded rect
    this.roundedRectPath(ctx, x, y, rw, rh, BG_RADIUS);
    ctx.fillStyle = BG_FILL;
    ctx.fill();

    // Clip the grid to the rounded rect
    this.roundedRectPath(ctx, x, y, rw, rh, BG_RADIUS);
    ctx.clip();

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = x; gx <= x + rw; gx += GRID_STEP) {
      ctx.moveTo(gx + 0.5, y);
      ctx.lineTo(gx + 0.5, y + rh);
    }
    for (let gy = y; gy <= y + rh; gy += GRID_STEP) {
      ctx.moveTo(x, gy + 0.5);
      ctx.lineTo(x + rw, gy + 0.5);
    }
    ctx.stroke();

    ctx.restore();

    // Border (drawn after restore so clip doesn't affect it)
    this.roundedRectPath(ctx, x, y, rw, rh, BG_RADIUS);
    ctx.strokeStyle = BG_BORDER;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private roundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  // ── Draw functions ──────────────────────────────────────

  private drawGhostSpeed(ctx: CanvasRenderingContext2D, time: number, w: number, h: number): void {
    const cy = h / 2;
    const padX = 24;
    const offsetY = Math.min(32, h * 0.22);

    this.dot(ctx, padX, cy, 12, CYAN);

    const slowX = padX + (w - padX * 2) * ((time / 3) % 1) * 0.6;
    this.ghost(ctx, slowX, cy - offsetY, DIM, 12);
    this.trail(ctx, padX, cy - offsetY, slowX, DIM, 4);

    const fastX = padX + (w - padX * 2) * ((time / 3) % 1);
    this.ghost(ctx, fastX, cy + offsetY, CYAN, 12);
    this.trail(ctx, padX, cy + offsetY, fastX, CYAN, 4);
  }

  private drawGhostLifetime(ctx: CanvasRenderingContext2D, time: number, w: number, h: number): void {
    const cy = h / 2;
    const padX = 24;
    const offsetY = Math.min(32, h * 0.22);
    const totalW = w - padX * 2;

    const baseX = padX + totalW * Math.min(time / 3, 0.6);
    const baseAlpha = Math.max(0, 1 - (time / 3) * 2);
    ctx.globalAlpha = baseAlpha;
    this.ghost(ctx, baseX, cy - offsetY, DIM, 12);
    this.trail(ctx, padX, cy - offsetY, baseX, DIM, 4);
    ctx.globalAlpha = 1;

    const upgX = padX + totalW * Math.min(time / 3, 1);
    const upgAlpha = Math.max(0, 1 - (time / 3) * 1.2);
    ctx.globalAlpha = upgAlpha;
    this.ghost(ctx, upgX, cy + offsetY, CYAN, 12);
    this.trail(ctx, padX, cy + offsetY, upgX, CYAN, 4);
    ctx.globalAlpha = 1;
  }

  private drawGhostCooldown(ctx: CanvasRenderingContext2D, time: number, w: number, h: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;

    const slowPct = (time % 3) / 3;
    this.ring(ctx, cx - R * 0.6 - 4, cy, R * 0.7, slowPct, DIM);

    const fastPct = (time % 2) / 2;
    this.ring(ctx, cx + R * 0.6 + 4, cy, R * 0.7, fastPct, CYAN);
  }

  private drawPassiveSpeed(ctx: CanvasRenderingContext2D, time: number, w: number, h: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;

    const slowAngle = time * Math.PI * 0.8;
    const sx = cx + Math.cos(slowAngle) * R * 0.65;
    const sy = cy + Math.sin(slowAngle) * R * 0.65;
    this.orbitPath(ctx, cx, cy, R * 0.65, DIM);
    this.dot(ctx, sx, sy, 9, DIM);

    const fastAngle = time * Math.PI * 1.6;
    const fx = cx + Math.cos(fastAngle) * R;
    const fy = cy + Math.sin(fastAngle) * R;
    this.orbitPath(ctx, cx, cy, R, CYAN);
    this.dot(ctx, fx, fy, 12, CYAN);
  }

  // ── Primitives ──────────────────────────────────────────

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private ghost(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 11): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private trail(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    color: string,
    width = 4,
  ): void {
    if (Math.abs(toX - fromX) < 2) return;
    const grad = ctx.createLinearGradient(fromX, 0, toX, 0);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(1, color);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, fromY);
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  private ring(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    pct: number,
    color: string,
  ): void {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  private orbitPath(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    color: string,
  ): void {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
