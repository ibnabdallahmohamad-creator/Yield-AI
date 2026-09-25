/**
 * Isolines over the weather map (isotherms, isobars, humidity lines): the field is sampled on a
 * 6 px screen grid, traced with marching squares and drawn as thin white lines; every `major` level
 * is bolder and labelled along the line, spaced so labels never crowd. Redrawn when the view, the
 * time or the layer changes (at most every 90 ms while the timeline plays).
 */
import L from "leaflet";
import { contourLevels, marchingSquares } from "@/lib/weather/contours";
import { FieldSampler, type WeatherField } from "@/lib/weather/field";
import type { WeatherLayerDef } from "@/lib/weather/layers";

const SAMPLE_PX = 6;
const LABEL_GAP = 170;

export class IsolineCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private field: WeatherField | null = null;
  private def: WeatherLayerDef | null = null;
  private t = 0;
  private raf = 0;
  private last = 0;
  private enabled = true;
  private tone: "light" | "dark" = "light";

  constructor(
    private map: L.Map,
    pane: string,
  ) {
    this.canvas = L.DomUtil.create("canvas", "yai-wx-canvas", map.getPane(pane));
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d")!;
    map.on("zoomstart", this.hide);
    map.on("moveend zoomend resize", this.redrawNow);
  }

  set(field: WeatherField, def: WeatherLayerDef, t: number, enabled: boolean, tone: "light" | "dark") {
    this.field = field;
    this.def = def;
    this.t = t;
    this.enabled = enabled;
    this.tone = tone;
    const now = performance.now();
    if (now - this.last > 90) this.redrawNow();
    else if (!this.raf) this.raf = window.setTimeout(this.redrawNow, 90) as unknown as number;
  }

  destroy() {
    window.clearTimeout(this.raf);
    this.map.off("zoomstart", this.hide);
    this.map.off("moveend zoomend resize", this.redrawNow);
    this.canvas.remove();
  }

  private hide = () => {
    this.canvas.style.visibility = "hidden";
  };

  private redrawNow = () => {
    window.clearTimeout(this.raf);
    this.raf = 0;
    this.last = performance.now();
    this.draw();
    this.canvas.style.visibility = "";
  };

  private draw() {
    const map = this.map;
    const size = map.getSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(size.x * dpr));
    this.canvas.height = Math.max(1, Math.round(size.y * dpr));
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const { field, def } = this;
    if (!this.enabled || !field || !def?.isolines) return;

    const cols = Math.ceil(size.x / SAMPLE_PX) + 1;
    const rows = Math.ceil(size.y / SAMPLE_PX) + 1;
    const lngs = new Float64Array(cols);
    const lats = new Float64Array(rows);
    for (let c = 0; c < cols; c++) lngs[c] = map.containerPointToLatLng([c * SAMPLE_PX, 0]).lng;
    for (let r = 0; r < rows; r++) lats[r] = map.containerPointToLatLng([0, r * SAMPLE_PX]).lat;
    const sampler = new FieldSampler(field, this.t);
    const values = new Float32Array(cols * rows);
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = sampler.value(def.field, lats[r], lngs[c]);
        values[r * cols + c] = v;
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    const { step, major } = def.isolines;
    // Keep lines apart: where the field is steep (the coast on a summer afternoon), 1 °C lines would
    // merge, so widen the step until the steep 10 % of the view has lines at least ~7 px apart, and
    // never draw more than ~36 levels.
    const grads: number[] = [];
    for (let r = 0; r < rows - 1; r += 2) {
      for (let c = 0; c < cols - 1; c += 2) {
        const k = r * cols + c;
        const g = Math.hypot(values[k + 1] - values[k], values[k + cols] - values[k]) / SAMPLE_PX;
        if (Number.isFinite(g)) grads.push(g);
      }
    }
    grads.sort((a, b) => a - b);
    const steep = grads.length ? grads[Math.floor(grads.length * 0.9)] : 0;
    const span = max - min;
    const need = Math.max(steep * 7, span / 36);
    const stepUsed = [1, 2, 2.5, 5, 10, 20].map((m) => step * m).find((s) => s >= need) ?? step * 20;
    const sets = marchingSquares(values, cols, rows, contourLevels(min, max, stepUsed));
    const light = this.tone === "light";
    const lineRgb = light ? "255,255,255" : "22,30,26";

    for (const set of sets) {
      const isMajor = Math.abs(set.level / major - Math.round(set.level / major)) < 1e-6;
      ctx.beginPath();
      const s = set.segments;
      for (let i = 0; i < s.length; i += 4) {
        ctx.moveTo(s[i] * SAMPLE_PX, s[i + 1] * SAMPLE_PX);
        ctx.lineTo(s[i + 2] * SAMPLE_PX, s[i + 3] * SAMPLE_PX);
      }
      ctx.lineWidth = isMajor ? 1.4 : 0.8;
      ctx.strokeStyle = `rgba(${lineRgb},${isMajor ? 0.78 : 0.42})`;
      ctx.stroke();
    }

    // Labels: majors first, then minors if there is room, always along the line and upright.
    const placed: Array<[number, number]> = [];
    const ordered = [...sets].sort((a, b) => Number(isMajorOf(b.level, major)) - Number(isMajorOf(a.level, major)));
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const set of ordered) {
      const isMajor = isMajorOf(set.level, major);
      const gap = isMajor ? LABEL_GAP : LABEL_GAP * 1.3;
      const s = set.segments;
      let count = 0;
      // Walk the segments with a stride so labels spread along long lines.
      const stride = Math.max(4, Math.floor(s.length / 4 / 12) * 4);
      for (let i = 0; i < s.length && count < (isMajor ? 5 : 2); i += stride) {
        const x = ((s[i] + s[i + 2]) / 2) * SAMPLE_PX;
        const y = ((s[i + 1] + s[i + 3]) / 2) * SAMPLE_PX;
        if (x < 28 || y < 20 || x > size.x - 28 || y > size.y - 20) continue;
        if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < (isMajor ? gap : gap))) continue;
        // Direction along the line from the local gradient (smoother than one tiny segment).
        const c = Math.round(x / SAMPLE_PX);
        const r = Math.round(y / SAMPLE_PX);
        const gx = values[r * cols + Math.min(cols - 1, c + 1)] - values[r * cols + Math.max(0, c - 1)];
        const gy = values[Math.min(rows - 1, r + 1) * cols + c] - values[Math.max(0, r - 1) * cols + c];
        let ang = Math.atan2(gx, -gy);
        if (!Number.isFinite(ang)) ang = 0;
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        const text = formatLevel(set.level, def.decimals > 0 && stepUsed < 1);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.lineWidth = 3;
        ctx.strokeStyle = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.8)";
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = light ? "#ffffff" : "#16201b";
        ctx.fillText(text, 0, 0);
        ctx.restore();
        placed.push([x, y]);
        count++;
      }
    }
  }
}

const isMajorOf = (level: number, major: number) => Math.abs(level / major - Math.round(level / major)) < 1e-6;
const formatLevel = (v: number, decimals: boolean) => (decimals ? v.toFixed(1) : String(Math.round(v)));
