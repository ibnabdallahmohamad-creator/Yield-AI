import { describe, expect, it } from "vitest";
import { describeLocation, distanceToCoastKm, isInQatar } from "./location";
import { monthsLabel, priceSignal, qatarSeason } from "./market";

describe("Qatar location", () => {
  it("describes a farm near Al Khor: municipality, coast and groundwater basin", () => {
    const l = describeLocation([51.3732, 25.747]);
    expect(l.in_qatar).toBe(true);
    expect(l.municipality).toBe("Al Khor");
    expect(l.groundwater_basin).toBe("northern");
    expect(l.coast_band).toBe("near-coast");
    expect(l.distance_to_coast_km).toBeGreaterThan(10);
    expect(l.distance_to_coast_km).toBeLessThan(20);
    expect(l.notes.length).toBeGreaterThan(0);
  });

  it("puts the south on the southern basin and the Doha corniche on the coast", () => {
    expect(describeLocation([51.1, 25.3]).groundwater_basin).toBe("southern");
    expect(distanceToCoastKm(25.2925, 51.53)).toBeLessThan(5);
    expect(distanceToCoastKm(25.3, 51.1)).toBeGreaterThan(15);
  });

  it("knows what is outside Qatar", () => {
    expect(isInQatar(25.3, 51.2)).toBe(true);
    expect(isInQatar(26.07, 50.55)).toBe(false); // Bahrain
    expect(isInQatar(24.3, 51.0)).toBe(false); // Saudi Arabia
    expect(isInQatar(25.0, 52.0)).toBe(false); // the Gulf
  });
});

describe("Qatar market calendar", () => {
  it("names the supply seasons", () => {
    expect(qatarSeason(1)).toBe("peak");
    expect(qatarSeason(7)).toBe("summer");
    expect(qatarSeason(10)).toBe("shoulder");
  });

  it("flags summer shortages and winter gluts", () => {
    expect(priceSignal("tomato", 7)).toBe("scarce");
    expect(priceSignal("cucumber", 1)).toBe("glut");
    expect(priceSignal("alfalfa", 7)).toBe("normal");
  });

  it("labels month runs, including runs across the new year", () => {
    expect(monthsLabel([9, 10, 11])).toBe("Sep–Nov");
    expect(monthsLabel([9, 10, 11, 2])).toBe("Sep–Nov, Feb");
    expect(monthsLabel([9, 10, 11, 12, 1])).toBe("Sep–Jan");
    expect(monthsLabel([1, 9, 10, 11, 12])).toBe("Sep–Jan");
  });
});
