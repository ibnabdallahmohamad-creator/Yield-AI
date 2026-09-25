import { describe, expect, it } from "vitest";
import { describeLocation } from "../qatar/location";
import { summariseArchive, TYPICAL_QATAR_CLIMATE } from "./climate";
import { landUseOption } from "./options";
import { applyAdjustments, assessWater, goalRows, rankOptions, waterNeed_m3_ha, type SiteInput } from "./score";

const khor = describeLocation([51.3732, 25.747]);
const sheehaniya = describeLocation([51.1, 25.3]);

function site(overrides: Partial<SiteInput> & Pick<SiteInput, "water">): SiteInput {
  return { location: khor, climate: TYPICAL_QATAR_CLIMATE, area_ha: 10, budget: "medium", ...overrides };
}

const byId = (options: ReturnType<typeof rankOptions>) => new Map(options.map((o) => [o.id, o]));

describe("water assessment", () => {
  it("uses the measured EC, then the farm's, then the basin's typical value", () => {
    expect(assessWater("groundwater", 3.2, khor, 2.6)).toMatchObject({ ec_dS_m: 3.2, ec_origin: "measured", ece_expected_dS_m: 4.8 });
    expect(assessWater("groundwater", null, khor, 2.6)).toMatchObject({ ec_dS_m: 2.6, ec_origin: "farm" });
    expect(assessWater("groundwater", null, sheehaniya, null).ec_origin).toBe("basin typical");
    expect(assessWater("tse", null, khor, null)).toMatchObject({ ec_dS_m: 1.8, ec_origin: "source typical" });
  });

  it("classifies water by FAO-29 restriction", () => {
    expect(assessWater("desalinated", null, khor, null).class).toBe("No restriction");
    expect(assessWater("groundwater", 2, khor, null).class).toBe("Slight to moderate restriction");
    expect(assessWater("groundwater", 6, khor, null).class).toBe("Severe restriction");
  });
});

describe("ranking", () => {
  it("blocks what can't work: TSE on vegetables, fodder on groundwater, poultry on salty water", () => {
    const tse = byId(rankOptions(site({ water: assessWater("tse", null, khor, null) })));
    expect(tse.get("greenhouse-veg")?.blocked).toMatch(/TSE/);
    expect(tse.get("fodder-tse")?.blocked).toBeNull();
    expect(tse.get("fodder-tse")?.fit).toBe("strong");

    const salty = byId(rankOptions(site({ location: sheehaniya, water: assessWater("groundwater", 7.9, sheehaniya, null) })));
    expect(salty.get("fodder-tse")?.blocked).toMatch(/groundwater/);
    expect(salty.get("table-eggs")?.blocked).toMatch(/poultry/);
    expect(salty.get("greenhouse-veg")?.blocked).toMatch(/Too salty/);
    for (const o of salty.values()) if (o.blocked) expect(o.score).toBeLessThanOrEqual(15);
  });

  it("ranks the salt-tolerant date palm above greenhouse tomato on brackish water", () => {
    const r = byId(rankOptions(site({ location: sheehaniya, water: assessWater("groundwater", 5, sheehaniya, null) })));
    expect(r.get("date-palms")!.score).toBeGreaterThan(r.get("greenhouse-veg")!.score);
  });

  it("rewards a high budget and fresh water with controlled-environment farming", () => {
    const low = byId(rankOptions(site({ water: assessWater("desalinated", null, khor, null), budget: "low" })));
    const high = byId(rankOptions(site({ water: assessWater("desalinated", null, khor, null), budget: "high" })));
    expect(high.get("hydroponic-leafy")!.score).toBeGreaterThan(low.get("hydroponic-leafy")!.score);
    expect(high.get("hydroponic-leafy")!.factors.water.score).toBe(1);
  });

  it("sorts best first and explains each option", () => {
    const ranked = rankOptions(site({ water: assessWater("groundwater", 2.6, khor, null) }));
    expect(ranked.map((o) => o.score)).toEqual([...ranked.map((o) => o.score)].sort((a, b) => b - a));
    expect(ranked).toHaveLength(8);
    for (const o of ranked) {
      expect(o.first_steps.length).toBeGreaterThan(0);
      expect(Object.keys(o.factors)).toEqual(["water", "goal", "market", "budget", "policy", "site"]);
    }
  });

  it("applies research changes within ±10 and keeps blocked options capped", () => {
    const ranked = rankOptions(site({ water: assessWater("groundwater", 2.6, khor, null) }));
    const fodder = ranked.find((o) => o.id === "fodder-tse")!;
    const eggs = ranked.find((o) => o.id === "table-eggs")!;
    const out = byId(
      applyAdjustments(ranked, [
        { id: "table-eggs", delta: 40, note: "Egg prices up" },
        { id: "fodder-tse", delta: 10, note: "More TSE" },
      ]),
    );
    expect(out.get("table-eggs")!.score).toBe(Math.min(100, eggs.base_score + 10));
    expect(out.get("table-eggs")!.research_delta).toBe(10);
    expect(out.get("fodder-tse")!.score).toBeLessThanOrEqual(15);
    expect(fodder.blocked).not.toBeNull();
  });
});

describe("site water need", () => {
  it("counts only the growing months and grosses up for leaching", () => {
    const winter = waterNeed_m3_ha(landUseOption("openfield-winter-veg"), TYPICAL_QATAR_CLIMATE, 1)!;
    const dates = waterNeed_m3_ha(landUseOption("date-palms"), TYPICAL_QATAR_CLIMATE, 1)!;
    expect(winter).toBeLessThan(dates);
    const fresh = waterNeed_m3_ha(landUseOption("date-palms"), TYPICAL_QATAR_CLIMATE, 0.5)!;
    expect(dates).toBeGreaterThan(fresh);
    expect(waterNeed_m3_ha(landUseOption("table-eggs"), TYPICAL_QATAR_CLIMATE, 1)).toBeNull();
  });
});

describe("climate archive summary", () => {
  it("summarises a year of daily values", () => {
    const time = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 8, 19 + i)).toISOString().slice(0, 10));
    const month = (t: string) => Number(t.slice(5, 7));
    const summer = (t: string) => [6, 7, 8, 9].includes(month(t));
    const c = summariseArchive({
      elevation: 16,
      daily: {
        time,
        temperature_2m_max: time.map((t) => (summer(t) ? 44 : 30)),
        temperature_2m_min: time.map((t) => ([12, 1, 2].includes(month(t)) ? 14 : 25)),
        relative_humidity_2m_mean: time.map(() => 50),
        wind_speed_10m_mean: time.map(() => 4),
        wind_speed_10m_max: time.map((_, i) => (i % 30 === 0 ? 11 : 7)),
        et0_fao_evapotranspiration: time.map((t) => (summer(t) ? 8 : 4)),
        precipitation_sum: time.map((_, i) => (i === 100 ? 20 : 0)),
      },
    })!;
    expect(c.source).toBe("open-meteo-archive");
    expect(c.summer_tmax_mean_c).toBe(44);
    expect(c.winter_tmin_mean_c).toBe(14);
    expect(c.et0_monthly_mm[6]).toBe(248); // July: 31 × 8
    expect(c.dust_wind_days).toBe(13);
    expect(c.rain_annual_mm).toBe(20);
    expect(summariseArchive({})).toBeNull();
  });
});

describe("national goals", () => {
  it("lists the biggest gap first", () => {
    const rows = goalRows();
    expect(rows[0].product).toBe("table-eggs");
    expect(rows[0].gap_pct).toBe(43);
  });
});
