import { describe, expect, it } from "vitest";
import { isSectioned, kindForTitle, parseHeading, splitAnswer } from "./sections";

const kinds = (text: string) => splitAnswer(text).map((s) => s.kind);
const titles = (text: string) => splitAnswer(text).map((s) => s.title);

describe("splitAnswer", () => {
  it("splits Markdown headings and keeps the text before them as the summary", () => {
    const text = [
      "Salinity is the main problem on this farm right now.",
      "",
      "## Diagnosis",
      "ECe rose from 3.5 to 5.9 dS/m in 30 days.",
      "",
      "## Recommended actions",
      "1. Apply 13 mm instead of 11 mm.",
      "2. Inspect the drippers around KN-02.",
      "",
      "### Weather",
      "No rain expected in the next 12 hours.",
    ].join("\n");
    const sections = splitAnswer(text);
    expect(sections.map((s) => s.kind)).toEqual(["summary", "diagnosis", "actions", "weather"]);
    expect(sections[2].body).toBe("1. Apply 13 mm instead of 11 mm.\n2. Inspect the drippers around KN-02.");
    expect(sections[1].title).toBe("Diagnosis");
  });

  it("reads bold headings and bold labels with inline text", () => {
    const text = "**Summary:** The field is dry.\n\n**Irrigation**\nApply 12 mm today.\n\n**What to do:**\n- Irrigate now\n- Check laterals";
    expect(kinds(text)).toEqual(["summary", "irrigation", "actions"]);
    expect(splitAnswer(text)[0].body).toBe("The field is dry.");
  });

  it("reads 'Title:' lines, ALL CAPS and numbered section titles", () => {
    expect(kinds("Overview:\nAll good.\n\nRISKS\nHeat stress this afternoon.\n\n3. Next steps\n- Water at dawn")).toEqual([
      "summary",
      "risk",
      "actions",
    ]);
  });

  it("does not mistake values or instructions for headings", () => {
    expect(parseHeading("ECe: 5.9 dS/m (moderately saline)")).toBeNull();
    expect(parseHeading("**pH:** 8.1")).toBeNull();
    expect(parseHeading("1. Irrigate today")).toBeNull();
    expect(parseHeading("**Irrigate today.** Root-zone depletion is 18 mm.")).toBeNull();
    expect(parseHeading("Recommendation: flush the drip lines")).toEqual({ title: "Recommendation", rest: "flush the drip lines" });
  });

  it("maps JSON answers to sections", () => {
    const json = JSON.stringify({
      summary: "High salinity risk.",
      diagnosis: "ECe is above the tomato threshold.",
      recommendations: [
        { title: "Leach", detail: "Apply 17% extra water", priority: "high" },
        { title: "Test", detail: "Send a saturated-paste sample" },
      ],
      confidence: 0.8,
    });
    const sections = splitAnswer(json);
    expect(sections.map((s) => s.kind)).toEqual(["summary", "diagnosis", "actions"]);
    expect(sections[2].body).toContain("1. **Leach** (high priority) — Apply 17% extra water");
  });

  it("unwraps { answer } JSON and fenced JSON", () => {
    expect(kinds('{"answer": "## Summary\\nFine.\\n\\n## Risks\\nNone today."}')).toEqual(["summary", "risk"]);
    expect(kinds('```json\n{"summary": "ok", "risks": ["heat"]}\n```')).toEqual(["summary", "risk"]);
  });

  it("classifies unlabelled paragraphs and instruction lists", () => {
    const text = [
      "Your farm is in good shape overall.",
      "",
      "Salinity has crept up: ECe is 3.1 dS/m against a 2.5 dS/m threshold, so leaching is due.",
      "",
      "1. Apply a leaching irrigation of 14 mm.",
      "2. Check emitter pressure in the north-east block.",
      "3. Re-check ECe in a week.",
    ].join("\n");
    expect(kinds(text)).toEqual(["summary", "salinity", "actions"]);
  });

  it("splits one long paragraph by sentence, keeping decimals intact", () => {
    const text =
      "The farm is moderately stressed today. Soil moisture is 7.2% against a trigger of 8.5%, so the root zone has used more than its readily available water. " +
      "Salinity is stable at 2.1 dS/m, below the tomato threshold of 2.5 dS/m, which means no yield loss is predicted yet. " +
      "Irrigate 11 mm this evening and split it into two pulses. Check the drippers around probe KN-03, which reads driest. " +
      "Keep an eye on the forecast heat tomorrow afternoon, when evaporative demand peaks near 7 mm per day.";
    const sections = splitAnswer(text);
    expect(sections[0].kind).toBe("summary");
    expect(sections[0].body).toContain("7.2%");
    expect(sections.find((s) => s.kind === "actions")?.body).toMatch(/^1\. Irrigate 11 mm/);
    expect(sections.some((s) => s.kind === "salinity")).toBe(true);
  });

  it("returns a single summary for short plain answers", () => {
    const sections = splitAnswer("Yes — irrigate 12 mm tonight.");
    expect(sections).toEqual([{ kind: "summary", title: "Summary", body: "Yes — irrigate 12 mm tonight." }]);
    expect(isSectioned(sections)).toBe(false);
    expect(splitAnswer("   ")).toEqual([]);
  });

  it("keeps the model's own heading wording as the title", () => {
    expect(titles("## Salinity at Al Khor\nRising.\n\n## Do first\n1. Leach")).toEqual(["Salinity at Al Khor", "Do first"]);
  });
});

describe("kindForTitle", () => {
  it("knows common section names and keywords", () => {
    expect(kindForTitle("Next steps")).toBe("actions");
    expect(kindForTitle("TL;DR")).toBe("summary");
    expect(kindForTitle("Fertigation plan")).toBe("nutrients");
    expect(kindForTitle("Action plan")).toBe("actions");
    expect(kindForTitle("Weather for the next 12 hours")).toBe("weather");
    expect(kindForTitle("Something else", { exactOnly: true })).toBeNull();
  });
});
