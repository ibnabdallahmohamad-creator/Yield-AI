import { describe, expect, it } from "vitest";
import { actionAnchor, actionKey, activeTicks, tickHolds } from "./done-actions";

describe("actionKey", () => {
  it("keeps one identity while the day and the amounts change", () => {
    expect(actionKey("f", "Apply a leaching irrigation on Sunday (+26% water)")).toBe(actionKey("f", "Apply a leaching irrigation tomorrow (+17% water)"));
    expect(actionKey("f", "Next irrigation on Monday: 25 mm")).toBe(actionKey("f", "Next irrigation in about 9 days: 31 mm"));
    expect(actionKey("f", "Irrigate today: 25 mm")).toBe("f|irrigate");
    expect(actionKey("f", "Watch soil alkalinity (pH 8.12)")).toBe("f|watch soil alkalinity");
  });

  it("tells farms and places apart", () => {
    expect(actionKey("a", "Irrigate today: 25 mm")).not.toBe(actionKey("b", "Irrigate today: 25 mm"));
    expect(actionKey("f", "Inspect the salty patch in the north-west, around SG-06")).not.toBe(actionKey("f", "Inspect the salty patch in the north-west, around SG-05"));
  });

  it("makes an anchor from the title", () => {
    expect(actionAnchor("Apply a leaching irrigation on Sunday (+26% water)")).toBe("do-apply-a-leaching-irrigation");
    expect(actionAnchor("Inspect the salty patch in the north-east, around KN-02")).toBe("do-inspect-the-salty-patch-in-the-north-east-around-kn-02");
  });
});

describe("ticks", () => {
  it("last the day for watering and a week for the rest", () => {
    expect(tickHolds("f|irrigate", "2026-09-25", "2026-09-25")).toBe(true);
    expect(tickHolds("f|irrigate", "2026-09-25", "2026-09-26")).toBe(false);
    expect(tickHolds("f|apply a leaching irrigation", "2026-09-24", "2026-09-25")).toBe(false);
    expect(tickHolds("f|top up potassium in the next fertigation", "2026-09-19", "2026-09-25")).toBe(true);
    expect(tickHolds("f|top up potassium in the next fertigation", "2026-09-18", "2026-09-25")).toBe(false);
    expect(tickHolds("f|lower the salt load of the irrigation water", "2026-09-22", "2026-09-25")).toBe(true);
  });

  it("ignore ticks from the future or with a broken date", () => {
    expect(tickHolds("f|x", "2026-09-26", "2026-09-25")).toBe(false);
    expect(tickHolds("f|x", "nonsense", "2026-09-25")).toBe(false);
    expect([...activeTicks({ "f|x": "2026-09-25", "f|irrigate": "2026-09-24" }, "2026-09-25")]).toEqual(["f|x"]);
  });
});
