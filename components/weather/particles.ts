/**
 * Animated wind streaks (the earth.nullschool / Windy technique) on a canvas over the map: particles
 * are dropped at random, carried by the wind interpolated at their position, and leave trails that
 * fade a little every frame. The wind is sampled once per view on a 5 px screen grid, so each frame
 * is only a bilinear lookup per particle. Drawing stops while the map pans or zooms, when the tab is
 * hidden or the map is scrolled out of view. With reduced motion (or on request) it draws a still
 * grid of arrows instead.
 */
import L from "leaflet";
import { FieldSampler, type WeatherField } from "@/lib/weather/field";

const GRID_PX = 5;
/** Screen pixels a frame per m/s at zoom 8; grows gently with zoom. */
const SPEED_PX = 0.2;
/** Trail fade a frame. At most 0.9: stronger values leave faint ghost trails (8-bit alpha rounding stalls). */
const FADE = 0.9;
const MAX_AGE = [50, 110];

export type StreakMode = "streaks" | "arrows" | "off";

export class WindParticles {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private field: WeatherField | null = null;
  private t = 0;
  private mode: StreakMode = "streaks";
  private cols = 0;
  private rows = 0;
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private speed = new Float32Array(0);
  private parts = new Float32Array(0);
  private raf = 0;
  private moving = false;
  private visible = true;
  private dirtySince = 0;
  private builtAt = 0;
  private dpr = 1;
  private observer: IntersectionObserver | null = null;
  private reduced: MediaQueryList | null = null;

  constructor(
    private map: L.Map,
    pane: string,
    private tone: "light" | "dark" = "light",
  ) {
    this.canvas = L.DomUtil.create("canvas", "yai-wx-canvas", map.getPane(pane));
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    map.on("movestart zoomstart", this.onMoveStart);
    map.on("moveend zoomend resize", this.onMoveEnd);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(([e]) => {
        this.visible = e.isIntersecting;
        this.kick();
      });
      this.observer.observe(map.getContainer());
    }
    this.reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.reduced?.addEventListener?.("change", this.onMoveEnd);
    this.resize();
  }

  setTone(tone: "light" | "dark") {
    this.tone = tone;
    this.clear();
    this.kick();
  }

  setMode(mode: StreakMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.clear();
    this.rebuild();
  }

  /** New data or a new time: the grid is re-sampled on the next frame (at most every 150 ms). */
  setData(field: WeatherField, t: number) {
    const fresh = field !== this.field;
    this.field = field;
    this.t = t;
    if (fresh || this.mode === "arrows" || this.effectiveMode() === "arrows") this.rebuild();
    else this.dirtySince ||= performance.now();
    this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.map.off("movestart zoomstart", this.onMoveStart);
    this.map.off("moveend zoomend resize", this.onMoveEnd);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.reduced?.removeEventListener?.("change", this.onMoveEnd);
    this.observer?.disconnect();
    this.canvas.remove();
  }

  private effectiveMode(): StreakMode {
    if (this.mode === "streaks" && this.reduced?.matches) return "arrows";
    return this.mode;
  }

  private onVisibility = () => this.kick();

  private onMoveStart = () => {
    this.moving = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clear();
  };

  private onMoveEnd = () => {
    this.moving = false;
    this.resize();
    this.rebuild();
  };

  private resize() {
    const size = this.map.getSize();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(size.x * this.dpr));
    this.canvas.height = Math.max(1, Math.round(size.y * this.dpr));
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
  }

  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private rebuild() {
    this.buildGrid();
    if (this.effectiveMode() === "arrows") this.drawArrows();
    else if (this.effectiveMode() === "streaks") this.seed();
    else this.clear();
    this.kick();
  }

  /** Wind on a screen grid, converted to pixels a frame. Web Mercator is separable: lng by x, lat by y. */
  private buildGrid() {
    this.builtAt = performance.now();
    this.dirtySince = 0;
    const field = this.field;
    if (!field) return;
    const size = this.map.getSize();
    const cols = Math.ceil(size.x / GRID_PX) + 2;
    const rows = Math.ceil(size.y / GRID_PX) + 2;
    const lngs = new Float64Array(cols);
    const lats = new Float64Array(rows);
    for (let c = 0; c < cols; c++) lngs[c] = this.map.containerPointToLatLng([c * GRID_PX, 0]).lng;
    for (let r = 0; r < rows; r++) lats[r] = this.map.containerPointToLatLng([0, r * GRID_PX]).lat;
    const k = SPEED_PX * Math.pow(1.15, this.map.getZoom() - 8) * this.dpr;
    const sampler = new FieldSampler(field, this.t);
    const n = cols * rows;
    if (this.vx.length !== n) {
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.speed = new Float32Array(n);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { u, v } = sampler.wind(lats[r], lngs[c]);
        const i = r * cols + c;
        this.vx[i] = u * k;
        this.vy[i] = -v * k;
        this.speed[i] = Math.hypot(u, v);
      }
    }
    this.cols = cols;
    this.rows = rows;
  }

  /** Bilinear velocity at a canvas point (device pixels); NaN outside the data. */
  private velocity(x: number, y: number, out: Float32Array): boolean {
    const gx = x / this.dpr / GRID_PX;
    const gy = y / this.dpr / GRID_PX;
    const c = Math.floor(gx);
    const r = Math.floor(gy);
    if (c < 0 || r < 0 || c >= this.cols - 1 || r >= this.rows - 1) return false;
    const fx = gx - c;
    const fy = gy - r;
    const i = r * this.cols + c;
    const a = this.vx[i];
    const b = this.vx[i + 1];
    const d = this.vx[i + this.cols];
    const e = this.vx[i + this.cols + 1];
    if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(d) && Number.isFinite(e))) return false;
    out[0] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    out[1] = (this.vy[i] * (1 - fx) + this.vy[i + 1] * fx) * (1 - fy) + (this.vy[i + this.cols] * (1 - fx) + this.vy[i + this.cols + 1] * fx) * fy;
    out[2] = (this.speed[i] * (1 - fx) + this.speed[i + 1] * fx) * (1 - fy) + (this.speed[i + this.cols] * (1 - fx) + this.speed[i + this.cols + 1] * fx) * fy;
    return true;
  }

  private seed() {
    const size = this.map.getSize();
    const count = Math.round(Math.min(3000, Math.max(400, size.x * size.y * 0.0032)));
    this.parts = new Float32Array(count * 4);
    for (let p = 0; p < count; p++) this.respawn(p, true);
    this.clear();
  }

  private respawn(p: number, randomAge = false) {
    const o = p * 4;
    this.parts[o] = Math.random() * this.canvas.width;
    this.parts[o + 1] = Math.random() * this.canvas.height;
    const max = MAX_AGE[0] + Math.random() * (MAX_AGE[1] - MAX_AGE[0]);
    this.parts[o + 2] = randomAge ? Math.random() * max : 0;
    this.parts[o + 3] = max;
  }

  private kick() {
    if (this.raf || this.moving || this.effectiveMode() !== "streaks") return;
    if (document.hidden || !this.visible || !this.field) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private v = new Float32Array(3);

  private frame = () => {
    this.raf = 0;
    if (this.moving || document.hidden || !this.visible || this.effectiveMode() !== "streaks" || !this.field) return;
    if (this.dirtySince && performance.now() - this.builtAt > 150) this.buildGrid();
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Fade the old trails.
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = `rgba(0,0,0,${FADE})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.05 * this.dpr;
    const light = this.tone === "light";
    // Three brightness buckets by speed, one path each.
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    const parts = this.parts;
    const v = this.v;
    for (let p = 0; p < parts.length / 4; p++) {
      const o = p * 4;
      if (parts[o + 2] > parts[o + 3]) {
        this.respawn(p);
        continue;
      }
      const x = parts[o];
      const y = parts[o + 1];
      if (!this.velocity(x, y, v)) {
        this.respawn(p);
        continue;
      }
      const nx = x + v[0];
      const ny = y + v[1];
      if (nx < 0 || ny < 0 || nx > W || ny > H) {
        this.respawn(p);
        continue;
      }
      const bucket = v[2] < 3 ? 0 : v[2] < 8 ? 1 : 2;
      paths[bucket].moveTo(x, y);
      paths[bucket].lineTo(nx, ny);
      parts[o] = nx;
      parts[o + 1] = ny;
      parts[o + 2] += 1;
    }
    const colour = light ? "255,255,255" : "20,28,24";
    const alphas = light ? [0.36, 0.6, 0.88] : [0.35, 0.55, 0.8];
    for (let b = 0; b < 3; b++) {
      ctx.strokeStyle = `rgba(${colour},${alphas[b]})`;
      ctx.stroke(paths[b]);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** A still grid of arrows (reduced motion, or chosen): length by speed, pointing downwind. */
  private drawArrows() {
    this.clear();
    if (!this.field || this.cols === 0) return;
    const ctx = this.ctx;
    const d = this.dpr;
    const step = 46 * d;
    const light = this.tone === "light";
    const v = this.v;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Anchor the grid to world pixels, so arrows stay put on the ground as the map pans.
    const origin = this.map.getPixelBounds().min ?? L.point(0, 0);
    const offX = (((46 - (origin.x % 46)) % 46) + 23) * d;
    const offY = (((46 - (origin.y % 46)) % 46) + 23) * d;
    for (let y = offY % step; y < this.canvas.height; y += step) {
      for (let x = offX % step; x < this.canvas.width; x += step) {
        if (!this.velocity(x, y, v)) continue;
        const s = v[2];
        if (s < 0.3) continue;
        const len = Math.min(20, 7 + s * 1.3) * d;
        const ang = Math.atan2(v[1], v[0]);
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        const x0 = x - (cx * len) / 2;
        const y0 = y - (sy * len) / 2;
        const x1 = x + (cx * len) / 2;
        const y1 = y + (sy * len) / 2;
        const head = 5 * d;
        const draw = () => {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.moveTo(x1 - head * Math.cos(ang - 0.5), y1 - head * Math.sin(ang - 0.5));
          ctx.lineTo(x1, y1);
          ctx.lineTo(x1 - head * Math.cos(ang + 0.5), y1 - head * Math.sin(ang + 0.5));
          ctx.stroke();
        };
        ctx.strokeStyle = light ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.6)";
        ctx.lineWidth = 3.2 * d;
        draw();
        ctx.strokeStyle = light ? "rgba(255,255,255,0.92)" : "rgba(20,28,24,0.85)";
        ctx.lineWidth = 1.4 * d;
        draw();
      }
    }
  }
}
