import { describe, expect, it } from "vitest";
import { knowledgeFor, landContextAt, regionNotesFor } from "./context";
import { irrigatedEce, rankLandCrops } from "./crops";
import { CELL_DLAT, CELL_DLNG, cellGeometryAt, cellId, haversineKm, isInQatar, landCells, parseCellId } from "./grid";
import { searchKnowledge, tokenize } from "./knowledge";
import { allLandCells, landCellAt, landCellById, municipalitySummary } from "./profile";

describe("land grid", () => {
  const cells = landCells();

  it("covers Qatar's land with ≈10 km² cells", () => {
    // Qatar's land area is ≈11,500 km² → ≈1,150–1,250 cells once coastal slivers are kept.
    expect(cells.length).toBeGreaterThan(1100);
    expect(cells.length).toBeLessThan(1300);
    const total = cells.reduce((a, c) => a + c.landAreaKm2, 0);
    expect(total).toBeGreaterThan(11_000);
    expect(total).toBeLessThan(12_000);
    const full = cells.filter((c) => c.landFraction === 1);
    for (const c of full.slice(0, 50)) expect(c.landAreaKm2).toBeCloseTo(10, 0);
    expect(CELL_DLAT).toBeGreaterThan(0.028);
    expect(CELL_DLNG).toBeGreaterThan(0.031);
  });

  it("finds the cell under a point and round-trips ids", () => {
    const cell = cellGeometryAt(25.747, 51.373)!;
    expect(cell.municipality).toBe("Al Khor & Al Thakhira");
    expect(cell.bounds.south).toBeLessThanOrEqual(25.747);
    expect(cell.bounds.north).toBeGreaterThan(25.747);
    expect(parseCellId(cell.id)).toEqual({ row: cell.row, col: cell.col });
    expect(cellId(3, 7)).toBe("QA-R03-C07");
    expect(parseCellId("QA-R99-C99")).toBeNull();
  });

  it("knows land from sea and measures distance to the coast", () => {
    expect(isInQatar(25.33, 51.15)).toBe(true); // Al Sheehaniya
    expect(isInQatar(25.5, 52.2)).toBe(false); // the Gulf
    const inland = cellGeometryAt(25.33, 51.15)!;
    const doha = cellGeometryAt(25.29, 51.53)!;
    expect(inland.coastDistanceKm).toBeGreaterThan(20);
    expect(doha.coastDistanceKm).toBeLessThan(3);
    expect(haversineKm(25.29, 51.53, 25.29, 51.53)).toBe(0);
  });
});

describe("land profiles", () => {
  it("describes every cell with fertility, climate, groundwater and crops", () => {
    const all = allLandCells();
    for (const c of all) {
      expect(c.description.length).toBeGreaterThan(400);
      expect(c.climate.annualRain_mm).toBeGreaterThanOrEqual(45);
      expect(c.climate.annualRain_mm).toBeLessThanOrEqual(110);
      expect(c.climate.monthly).toHaveLength(12);
      expect(c.landscape.fertilityIndex).toBeGreaterThanOrEqual(0);
      expect(c.landscape.fertilityIndex).toBeLessThanOrEqual(100);
      if (c.landscape.arable) expect(c.crops.length).toBeGreaterThan(5);
      else expect(c.crops).toEqual([]);
    }
  });

  it("follows the published north–south rainfall gradient (≈55 → ≈105 mm)", () => {
    const north = landCellAt(26.05, 51.25)!;
    const south = landCellAt(24.75, 51.0)!;
    expect(north.climate.annualRain_mm).toBeGreaterThan(95);
    expect(south.climate.annualRain_mm).toBeLessThan(65);
    expect(landCellAt(25.29, 51.53)!.climate.annualRain_mm).toBeCloseTo(76, -1); // Doha ≈75 mm
  });

  it("is hotter in summer and colder in winter inland than on the coast", () => {
    const inland = landCellAt(25.33, 51.15)!;
    const coast = landCellAt(25.29, 51.53)!;
    expect(inland.climate.summerTmax_C).toBeGreaterThan(coast.climate.summerTmax_C);
    expect(inland.climate.winterTmin_C).toBeLessThan(coast.climate.winterTmin_C);
    expect(inland.climate.meanRh_pct).toBeLessThan(coast.climate.meanRh_pct);
    expect(inland.climate.annualEt0_mm).toBeGreaterThan(1500);
  });

  it("rates the northern rawdat above sabkha, dunes and the city", () => {
    const farmBelt = landCellAt(25.747, 51.373)!;
    expect(farmBelt.landscape.landform).toBe("rawdat-plain");
    expect(farmBelt.landscape.arable).toBe(true);
    expect(["Good", "High (for Qatar)"]).toContain(farmBelt.landscape.fertilityClass);
    expect(landCellAt(25.29, 51.53)!.landscape.landform).toBe("urban");
    expect(landCellAt(24.75, 51.0)!.landscape.arable).toBe(false);
    expect(landCellAt(24.7, 51.45)!.landscape.landform).toBe("dunes");
  });

  it("has fresher groundwater in the north than in the south", () => {
    const north = landCellAt(25.747, 51.373)!.landscape.groundwater;
    const south = landCellAt(24.85, 51.15)!.landscape.groundwater;
    expect(north.tds_mg_l).toBeLessThan(south.tds_mg_l);
    expect(north.ecw_dS_m).toBeCloseTo(north.tds_mg_l / 640, 0);
  });

  it("summarises municipalities and lists the demo farm in its cell", () => {
    expect(municipalitySummary("Al Shamal")).toMatch(/^Al Shamal: \d+ land cells/);
    expect(municipalitySummary("Nowhere")).toBeNull();
    expect(landCellAt(25.747, 51.373)!.demoFarms).toContain("Al Khor North Farm");
    expect(landCellById("QA-R45-C21")?.id).toBe("QA-R45-C21");
  });
});

describe("crop suitability (FAO-29, Maas–Hoffman)", () => {
  it("uses ECe ≈ 1.5 ECw and ranks salt-tolerant crops first", () => {
    expect(irrigatedEce(2)).toBe(3);
    const ranked = rankLandCrops(4); // ECe 6 dS/m
    expect(ranked[0].relativeYield).toBe(100);
    expect(ranked.find((c) => c.id === "barley")!.suitability).toBe("well-suited");
    expect(ranked.find((c) => c.id === "sweet_pepper")!.suitability).toBe("poor");
    // Tomato at ECe 6: 100 − 9.9 × (6 − 2.5) ≈ 65 %.
    expect(ranked.find((c) => c.id === "tomato")!.relativeYield).toBe(65);
    expect(ranked.find((c) => c.id === "tomato")!.relativeYieldLowSaltWater).toBe(100);
  });
});

describe("research knowledge (RAG)", () => {
  it("normalises words so salty / saline / salinity meet", () => {
    expect(tokenize("Salty soils?")).toEqual(["salt", "soil"]);
    expect(tokenize("How much rainfall")).toContain("rain");
  });

  it("retrieves the passages that match the question", () => {
    expect(searchKnowledge("How much does it rain in the north?")[0].id).toBe("qatar-rainfall");
    expect(searchKnowledge("Is my well water too salty for irrigation?").map((p) => p.id)).toContain("fao29-water-classes");
    expect(searchKnowledge("Which soils are most fertile? rawdat")[0].id).toBe("qatar-rawdat-soils");
    expect(searchKnowledge("date palm")[0].id).toBe("date-palm");
    expect(searchKnowledge("xyzzy")).toEqual([]);
    for (const p of knowledgeFor("groundwater recharge")) expect(p.source.length).toBeGreaterThan(10);
  });

  it("builds the land context the AI receives and names regions in the question", () => {
    const land = landContextAt(25.747, 51.373)!;
    expect(land.cell_id).toMatch(/^QA-R\d{2}-C\d{2}$/);
    expect(land.crops.length).toBeGreaterThan(0);
    expect(land.surroundings).toMatch(/neighbouring cells/);
    expect(landContextAt(26.5, 52.5)).toBeNull();
    expect(regionNotesFor("What grows well in Al Shamal?")[0]).toMatch(/^Al Shamal/);
    expect(regionNotesFor("How is my farm?")).toEqual([]);
  });
});
