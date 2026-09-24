/**
 * Screen-space layout for the farm pins on the overview map. Neighbouring farms (a few km apart)
 * overlap at country zoom, so overlapping pins are pushed apart (each keeps a leader line to its
 * true position), the selected farm's name tag goes above or below its pin, and every compare
 * badge takes the first free side of its pin. Pure geometry in pixels, so it is unit-tested.
 */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Side = "right" | "left" | "bottom" | "top";

export interface PinInput {
  id: string;
  /** Pixel position of the farm at the current zoom. */
  x: number;
  y: number;
  /** Pin radius in px. */
  r: number;
  /** The selected pin never moves. */
  fixed?: boolean;
  /** Size of the compare badge next to the pin, if any. */
  badge?: { w: number; h: number } | null;
}

export interface NameTag {
  pinId: string;
  w: number;
  h: number;
  /** Gap between the pin edge and the tag. */
  gap: number;
}

export interface PinPlacement {
  id: string;
  x: number;
  y: number;
  /** True when the pin was pushed away from its farm (draw a leader line). */
  displaced: boolean;
  badgeSide: Side | null;
}

export interface PinLayout {
  pins: PinPlacement[];
  tagSide: "top" | "bottom";
}

const BADGE_SIDES: Side[] = ["right", "left", "bottom", "top"];

export function sideRect(x: number, y: number, r: number, w: number, h: number, side: Side, gap = 3): Rect {
  switch (side) {
    case "right":
      return { x0: x + r + gap, y0: y - h / 2, x1: x + r + gap + w, y1: y + h / 2 };
    case "left":
      return { x0: x - r - gap - w, y0: y - h / 2, x1: x - r - gap, y1: y + h / 2 };
    case "bottom":
      return { x0: x - w / 2, y0: y + r + gap, x1: x + w / 2, y1: y + r + gap + h };
    case "top":
      return { x0: x - w / 2, y0: y - r - gap - h, x1: x + w / 2, y1: y - r - gap };
  }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

const circleRect = (x: number, y: number, r: number): Rect => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });

/** Pushes overlapping pins apart until every pair is at least `gap` px apart (fixed pins stay put). */
export function separatePins(pins: PinInput[], gap = 4, maxIterations = 120): { x: number; y: number }[] {
  const pos = pins.map((p) => ({ x: p.x, y: p.y }));
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let moved = false;
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i];
        const b = pins[j];
        if (a.fixed && b.fixed) continue;
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r + gap;
        if (d >= min - 0.01) continue;
        // Same spot: split along a deterministic direction (golden angle per index).
        const angle = (j * 2.399963) % (2 * Math.PI);
        const ux = d < 0.01 ? Math.cos(angle) : dx / d;
        const uy = d < 0.01 ? Math.sin(angle) : dy / d;
        const push = min - d;
        if (a.fixed) {
          pos[j].x += ux * push;
          pos[j].y += uy * push;
        } else if (b.fixed) {
          pos[i].x -= ux * push;
          pos[i].y -= uy * push;
        } else {
          pos[i].x -= (ux * push) / 2;
          pos[i].y -= (uy * push) / 2;
          pos[j].x += (ux * push) / 2;
          pos[j].y += (uy * push) / 2;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pos;
}

/**
 * Lays out the overview pins: separates them, puts the selected farm's name tag on the side of
 * its pin with fewer neighbours, then places compare badges greedily in list order (callers pass
 * pins most-important first) on the first side that collides with nothing already placed.
 */
export function layoutPins(pins: PinInput[], tag: NameTag | null = null, gap = 4): PinLayout {
  const pos = separatePins(pins, gap);
  const circles = pins.map((p, i) => circleRect(pos[i].x, pos[i].y, p.r));

  let tagSide: "top" | "bottom" = "top";
  const obstacles: Rect[] = [];
  const tagIndex = tag ? pins.findIndex((p) => p.id === tag.pinId) : -1;
  if (tag && tagIndex >= 0) {
    const { x, y } = pos[tagIndex];
    const r = pins[tagIndex].r;
    const cost = (side: "top" | "bottom") => {
      const rect = sideRect(x, y, r, tag.w, tag.h, side, tag.gap);
      return circles.reduce((sum, c, i) => (i === tagIndex ? sum : sum + overlapArea(rect, c)), 0);
    };
    const top = cost("top");
    tagSide = top > 0 && cost("bottom") < top ? "bottom" : "top";
    obstacles.push(sideRect(x, y, r, tag.w, tag.h, tagSide, tag.gap));
  }

  const placed: Rect[] = [];
  const placements: PinPlacement[] = pins.map((p, i) => {
    const { x, y } = pos[i];
    const displaced = Math.hypot(x - p.x, y - p.y) > 1;
    if (!p.badge) return { id: p.id, x, y, displaced, badgeSide: null };
    let best: { side: Side; cost: number } | null = null;
    for (const side of BADGE_SIDES) {
      const rect = sideRect(x, y, p.r, p.badge.w, p.badge.h, side);
      let cost = 0;
      circles.forEach((c, k) => {
        if (k !== i) cost += overlapArea(rect, c);
      });
      for (const o of obstacles) cost += overlapArea(rect, o);
      for (const o of placed) cost += overlapArea(rect, o);
      if (!best || cost < best.cost) best = { side, cost };
      if (cost === 0) break;
    }
    const side = best!.side;
    placed.push(sideRect(x, y, p.r, p.badge.w, p.badge.h, side));
    return { id: p.id, x, y, displaced, badgeSide: side };
  });

  return { pins: placements, tagSide };
}

/** Rough rendered width of a short label (px) — good enough to avoid collisions. */
export function estimateTextWidth(text: string, fontPx: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 0.28;
    else if (/[0-9]/.test(ch)) units += 0.58;
    else if (/[A-Z]/.test(ch)) units += 0.66;
    else if (/[a-z]/.test(ch)) units += 0.52;
    else units += 0.5;
  }
  return units * fontPx * (bold ? 1.06 : 1);
}
