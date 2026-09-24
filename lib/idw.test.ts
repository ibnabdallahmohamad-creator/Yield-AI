import { describe, expect, it } from "vitest";
import { polygonArea_ha, pointInPolygon, polygonCentroid, type GeoPolygon } from "./geo";
import { buildIdwGrid, DEFAULT_CELL_SIZE_M, IDW_POWER, idwValue } from "./idw";

// A ~200 m × 200 m square field near Al Khor.
const square: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [51.37, 25.74],
      [51.372, 25.74],
      [51.372, 25.7418],
      [51.37, 25.7418],
      [51.37, 25.74],
    ],
  ],
};

describe("IDW interpolation", () => {
  it("is exact at a sample and averages two equidistant samples", () => {
    const samples = [
      { x: 0, y: 0, value: 2 },
      { x: 100, y: 0, value: 6 },
    ];
    expect(idwValue(samples, 0, 0)).toBe(2);
    expect(idwValue(samples, 50, 0)).toBeCloseTo(4, 10);
    // Power 2: at x = 25 the weights are 1/25² and 1/75² → (2·9 + 6·1) / 10 = 2.4
    expect(idwValue(samples, 25, 0)).toBeCloseTo(2.4, 10);
  });

  it("builds a ~5 m grid clipped to the polygon with values bounded by the samples", () => {
    const grid = buildIdwGrid(square, [
      { lng: 51.3705, lat: 25.7405, value: 1.5 },
      { lng: 51.3715, lat: 25.7412, value: 4.5 },
      { lng: 51.3712, lat: 25.7403, value: 3 },
    ]);
    const inside = Array.from(grid.values).filter((v) => Number.isFinite(v));
    // Cell count ≈ polygon area / 25 m²
    const expectedCells = (polygonArea_ha(square) * 10_000) / 25;
    expect(inside.length).toBeGreaterThan(expectedCells * 0.9);
    expect(inside.length).toBeLessThan(expectedCells * 1.1);
    expect(grid.min).toBeGreaterThanOrEqual(1.5);
    expect(grid.max).toBeLessThanOrEqual(4.5);
  });

  it("marks cells outside a non-rectangular polygon as NaN", () => {
    const triangle: GeoPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [51.37, 25.74],
          [51.372, 25.74],
          [51.37, 25.7418],
          [51.37, 25.74],
        ],
      ],
    };
    const grid = buildIdwGrid(triangle, [{ lng: 51.3703, lat: 25.7403, value: 7 }]);
    const nan = Array.from(grid.values).filter((v) => Number.isNaN(v)).length;
    expect(nan / grid.values.length).toBeGreaterThan(0.4);
    expect(pointInPolygon(...polygonCentroid(triangle), triangle)).toBe(true);
  });

  it("fills the whole bounding box with clip: false (the map clips to the outline itself)", () => {
    const triangle: GeoPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [51.37, 25.74],
          [51.372, 25.74],
          [51.37, 25.7418],
          [51.37, 25.74],
        ],
      ],
    };
    const samples = [
      { lng: 51.3703, lat: 25.7403, value: 2 },
      { lng: 51.3712, lat: 25.7404, value: 5 },
    ];
    const clipped = buildIdwGrid(triangle, samples);
    const full = buildIdwGrid(triangle, samples, DEFAULT_CELL_SIZE_M, IDW_POWER, { clip: false });
    expect(full.cols).toBe(clipped.cols);
    expect(full.rows).toBe(clipped.rows);
    expect(Array.from(full.values).every((v) => Number.isFinite(v))).toBe(true);
    // Same interpolation inside the polygon: every clipped cell keeps its value.
    clipped.values.forEach((v, i) => {
      if (Number.isFinite(v)) expect(full.values[i]).toBeCloseTo(v, 5);
    });
    expect(full.min).toBeGreaterThanOrEqual(2);
    expect(full.max).toBeLessThanOrEqual(5);
  });
});
