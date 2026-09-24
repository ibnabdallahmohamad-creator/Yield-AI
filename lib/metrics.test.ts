import { describe, expect, it } from "vitest";
import { METRICS, classFor, colorFor, computeDelta, legendPosition, type MetricKey } from "./metrics";

describe("metric colour scales", () => {
  it.each(Object.keys(METRICS) as MetricKey[])("%s legend position is monotonic", (key) => {
    const m = METRICS[key];
    const lo = Number.isFinite(m.classes[0].min) ? m.classes[0].min : m.classes[0].max - 10;
    let prev = -1;
    for (let v = lo; v <= m.displayMax; v += (m.displayMax - lo) / 200) {
      const pos = legendPosition(m, v);
      expect(pos).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(1);
      prev = pos;
    }
  });

  it("uses the exact class colour at the middle of a class", () => {
    expect(colorFor(METRICS.ece, 3)).toBe("rgb(254, 204, 92)"); // #fecc5c, slightly saline
    expect(colorFor(METRICS.ece, 6)).toBe("rgb(253, 141, 60)"); // #fd8d3c, moderately saline
  });

  it("puts FAO ECe class boundaries in the right class", () => {
    expect(classFor(METRICS.ece, 1.99)?.label).toBe("Non-saline");
    expect(classFor(METRICS.ece, 2)?.label).toBe("Slightly saline");
    expect(classFor(METRICS.ece, 4)?.label).toBe("Moderately saline");
    expect(classFor(METRICS.ece, 16)?.label).toBe("Very strongly saline");
    expect(classFor(METRICS.ece, null)).toBeNull();
  });

  it("greys out missing values", () => {
    expect(colorFor(METRICS.moisture, null)).toBe("#9ca3af");
    expect(colorFor(METRICS.moisture, Number.NaN)).toBe("#9ca3af");
  });
});

describe("delta badges", () => {
  it("shows relative change for salinity, coloured as bad when rising", () => {
    expect(computeDelta(METRICS.ece, 5, 5.9)).toMatchObject({ text: "+18%", tone: "bad" });
    expect(computeDelta(METRICS.ece, 5.9, 5)).toMatchObject({ text: "−15%", tone: "good" });
  });

  it("shows absolute change for pH and percentage-point metrics", () => {
    expect(computeDelta(METRICS.ph, 7.8, 8.07)).toMatchObject({ text: "+0.27", tone: "neutral" });
    expect(computeDelta(METRICS.deficit, 50, 80)).toMatchObject({ text: "+30 pts", tone: "bad" });
    expect(computeDelta(METRICS.temperature, 34.2, 29.6)).toMatchObject({ text: "−4.6 °C" });
  });

  it("treats small changes as neutral and missing values as no badge", () => {
    expect(computeDelta(METRICS.ece, 5, 5.1)?.tone).toBe("neutral");
    expect(computeDelta(METRICS.ece, null, 5)).toBeNull();
  });
});
