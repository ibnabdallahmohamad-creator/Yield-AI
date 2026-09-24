import { describe, expect, it } from "vitest";
import { estimateTextWidth, layoutPins, separatePins, sideRect, type PinInput } from "./pin-layout";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("pin layout", () => {
  it("leaves pins that do not touch where they are", () => {
    const pins: PinInput[] = [
      { id: "a", x: 0, y: 0, r: 18 },
      { id: "b", x: 100, y: 0, r: 18 },
    ];
    const layout = layoutPins(pins);
    expect(layout.pins.map((p) => [p.x, p.y, p.displaced])).toEqual([
      [0, 0, false],
      [100, 0, false],
    ]);
  });

  it("pushes overlapping pins apart and never moves the fixed one", () => {
    const pins: PinInput[] = [
      { id: "sel", x: 50, y: 50, r: 22, fixed: true },
      { id: "b", x: 60, y: 52, r: 18 },
      { id: "c", x: 58, y: 40, r: 18 },
      { id: "d", x: 50, y: 50, r: 18 }, // exactly on top of the selected pin
    ];
    const pos = separatePins(pins, 4);
    expect(pos[0]).toEqual({ x: 50, y: 50 });
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        expect(dist(pos[i], pos[j])).toBeGreaterThanOrEqual(pins[i].r + pins[j].r + 4 - 0.5);
      }
    }
  });

  it("puts a badge on the first free side of its pin", () => {
    const badge = { w: 50, h: 18 };
    // A neighbour sits right of pin "a", so its badge moves to the left.
    const layout = layoutPins([
      { id: "a", x: 100, y: 100, r: 18, badge },
      { id: "b", x: 150, y: 100, r: 18 },
    ]);
    expect(layout.pins[0].badgeSide).toBe("left");
    expect(layout.pins[1].badgeSide).toBeNull();
  });

  it("keeps later badges off earlier ones", () => {
    const badge = { w: 60, h: 18 };
    const layout = layoutPins([
      { id: "a", x: 100, y: 100, r: 18, badge },
      { id: "b", x: 100, y: 150, r: 18, badge },
    ]);
    const [a, b] = layout.pins;
    const ra = sideRect(a.x, a.y, 18, 60, 18, a.badgeSide!);
    const rb = sideRect(b.x, b.y, 18, 60, 18, b.badgeSide!);
    const overlaps = ra.x0 < rb.x1 && rb.x0 < ra.x1 && ra.y0 < rb.y1 && rb.y0 < ra.y1;
    expect(overlaps).toBe(false);
  });

  it("flips the name tag below the selected pin when a neighbour is above it", () => {
    const tag = { pinId: "sel", w: 200, h: 26, gap: 6 };
    const above = layoutPins(
      [
        { id: "sel", x: 200, y: 200, r: 22, fixed: true },
        { id: "n", x: 200, y: 150, r: 18 },
      ],
      tag,
    );
    expect(above.tagSide).toBe("bottom");
    const clear = layoutPins([{ id: "sel", x: 200, y: 200, r: 22, fixed: true }], tag);
    expect(clear.tagSide).toBe("top");
  });

  it("estimates wider text for longer labels", () => {
    expect(estimateTextWidth("+215 pts", 10.5, true)).toBeGreaterThan(estimateTextWidth("+3%", 10.5, true));
    expect(estimateTextWidth("Al Shamal Greenhouses", 12)).toBeGreaterThan(100);
  });
});
