import { describe, expect, it } from "vitest";
import { polygonArea_ha } from "../geo";
import { fieldSummary, isInsideField, nextSensorId, parseLatLng, polygonFromPoints, sensorPrefix, slugify, squareFieldAround } from "./shapes";

describe("farm shapes", () => {
  it("draws a square field of the requested area around the pin", () => {
    const polygon = squareFieldAround(25.75, 51.37, 4);
    expect(polygon.coordinates[0]).toHaveLength(5);
    expect(polygonArea_ha(polygon)).toBeCloseTo(4, 1);
    const { lat, lng } = fieldSummary(polygon);
    expect(lat).toBeCloseTo(25.75, 4);
    expect(lng).toBeCloseTo(51.37, 4);
    expect(isInsideField(25.75, 51.37, polygon)).toBe(true);
    expect(isInsideField(25.76, 51.37, polygon)).toBe(false);
  });

  it("closes a drawn outline and rejects degenerate ones", () => {
    const poly = polygonFromPoints([
      [51.37, 25.75],
      [51.372, 25.75],
      [51.372, 25.752],
    ]);
    expect(poly?.coordinates[0]).toHaveLength(4);
    expect(poly?.coordinates[0][0]).toEqual(poly?.coordinates[0][3]);
    expect(polygonFromPoints([[51.37, 25.75], [51.371, 25.75]])).toBeNull();
    expect(polygonFromPoints([[51.37, 25.75], [51.37, 25.75], [51.37, 25.75]])).toBeNull();
  });

  it("parses typed coordinates", () => {
    expect(parseLatLng("25.7481, 51.3725")).toEqual({ lat: 25.7481, lng: 51.3725 });
    expect(parseLatLng("25.7481 51.3725")).toEqual({ lat: 25.7481, lng: 51.3725 });
    expect(parseLatLng("25.7481° N, 51.3725° E")).toEqual({ lat: 25.7481, lng: 51.3725 });
    expect(parseLatLng("Al Khor")).toBeNull();
    expect(parseLatLng("95, 51")).toBeNull();
  });

  it("makes ids and sensor ids", () => {
    expect(slugify("Green Valley Farm!")).toBe("green-valley-farm");
    expect(slugify("مزرعة")).toBe("farm");
    expect(sensorPrefix("Green Valley Farm")).toBe("GVF");
    expect(sensorPrefix("Oasis")).toBe("OAS");
    expect(nextSensorId("GVF", [])).toBe("GVF-01");
    expect(nextSensorId("GVF", ["GVF-01", "gvf-02"])).toBe("GVF-03");
  });
});
