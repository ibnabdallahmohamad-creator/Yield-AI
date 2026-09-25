import { describe, expect, it } from "vitest";
import { AiServiceChatResponseSchema, normalizeAiServicePayload } from "./contract";
import { answerPreview, answerToMarkdown, extractJsonObject, isStructuredAnswer, parseAnswer } from "./sections";

const MODEL_ANSWER = {
  task: "farm_analysis",
  summary: "Moisture is low in the east block; irrigate before 7 am.",
  insights: [{ title: "Soil is drying", detail: "Moisture fell from 24% to 17% in 3 days.", sources: ["R1"] }],
  warnings: [
    { title: "Heat stress", severity: "watch", detail: "Max 41 °C on Thursday." },
    { title: "Salinity rising", severity: "critical", detail: "EC 4.1 dS/m.", action: "Leach with 20% extra water." },
  ],
  forecast: { next_12_hours: "Hot and dry, wind 6 m/s from the NW.", next_7_days: "No rain expected." },
  economic_advice: { figures: [{ label: "Water cost", value: "QAR 120/week", basis: "0.9 QAR/m³" }], advice: ["Irrigate at night."] },
  recommendations: [
    { action: "Check the drip lines", priority: "low", when: "This week" },
    { action: "Irrigate 25 mm", priority: "high", when: "Before 7 am", why: "Moisture is below 18%." },
  ],
  crop_plan: { recommended: [{ crop: "Tomato", farm_type: "Greenhouse", why: "High value" }], avoid: [{ crop: "Lettuce", why: "Heat" }] },
  sources: [{ id: "S1", title: "MME irrigation guide", url: "https://example.org/guide" }],
  data_gaps: ["No pH probe on this farm."],
};

describe("parseAnswer — the fine-tuned model's JSON", () => {
  it("splits the answer into ordered sections without any model", () => {
    const parsed = parseAnswer(JSON.stringify(MODEL_ANSWER));
    expect(parsed.format).toBe("model-json");
    expect(parsed.task).toBe("farm_analysis");
    expect(parsed.summary).toMatch(/irrigate before 7 am/);
    const kinds = parsed.sections.map((s) => s.kind);
    expect(kinds).toEqual(["warnings", "insights", "recommendations", "forecast", "economics", "crop_plan", "data_gaps", "sources"]);
  });

  it("puts critical warnings first and high-priority steps first", () => {
    const parsed = parseAnswer(JSON.stringify(MODEL_ANSWER));
    const warnings = parsed.sections.find((s) => s.kind === "warnings")!;
    expect(warnings.items?.map((i) => i.badge?.tone)).toEqual(["critical", "watch"]);
    expect(warnings.items?.[0].detail).toContain("**Action:** Leach");
    const recs = parsed.sections.find((s) => s.kind === "recommendations")!;
    expect(recs.ordered).toBe(true);
    expect(recs.items?.map((i) => i.title)).toEqual(["Irrigate 25 mm", "Check the drip lines"]);
    expect(recs.items?.[0].meta).toBe("Before 7 am");
  });

  it("keeps figures, crop choices and links", () => {
    const parsed = parseAnswer(JSON.stringify(MODEL_ANSWER));
    expect(parsed.sections.find((s) => s.kind === "forecast")?.rows).toEqual([
      { label: "Next 7 days", value: "No rain expected." },
      { label: "Next 12 hours", value: "Hot and dry, wind 6 m/s from the NW." },
    ]);
    expect(parsed.sections.find((s) => s.kind === "economics")?.rows?.[0]).toEqual({ label: "Water cost", value: "QAR 120/week", detail: "0.9 QAR/m³" });
    const crops = parsed.sections.find((s) => s.kind === "crop_plan")!.items!;
    expect(crops.map((c) => [c.title, c.badge?.tone])).toEqual([
      ["Tomato", "good"],
      ["Lettuce", "avoid"],
    ]);
    expect(parsed.sections.find((s) => s.kind === "sources")?.items?.[0]).toMatchObject({ title: "MME irrigation guide", href: "https://example.org/guide" });
  });

  it("copes with fences, surrounding text, trailing commas, double encoding and truncation", () => {
    const json = JSON.stringify(MODEL_ANSWER, null, 2);
    expect(parseAnswer("```json\n" + json + "\n```").format).toBe("model-json");
    expect(parseAnswer(JSON.stringify(json)).format).toBe("model-json");
    expect(parseAnswer('{"summary": "Fine.", "insights": ["a", "b",], "warnings": [],}').summary).toBe("Fine.");
    const cut = json.slice(0, json.indexOf('"crop_plan"') + 30);
    const parsed = parseAnswer(cut);
    expect(parsed.format).toBe("model-json");
    expect(parsed.sections.some((s) => s.kind === "recommendations")).toBe(true);
  });

  it("does not mistake prose with braces for JSON", () => {
    expect(extractJsonObject("Use the {farm} template for this.")).toBeNull();
    expect(isStructuredAnswer("Plain answer.")).toBe(false);
    expect(isStructuredAnswer(JSON.stringify(MODEL_ANSWER))).toBe(true);
  });
});

describe("parseAnswer — report JSON and other JSON", () => {
  it("reads the report shape", () => {
    const parsed = parseAnswer(
      JSON.stringify({ risk_score: 72.4, risk_level: "high", summary: "Act today.", harvest: { status: "growing", window: { start: "2026-10-01", end: "2026-10-10" } } }),
    );
    expect(parsed.format).toBe("report-json");
    expect(parsed.sections[0]).toMatchObject({ title: "Risk", rows: [{ label: "Risk", value: "High · 72/100" }] });
    expect(parsed.sections.find((s) => s.kind === "harvest")?.rows).toContainEqual({ label: "Harvest window", value: "2026-10-01 – 2026-10-10" });
  });

  it("gives any other JSON one section per key", () => {
    const parsed = parseAnswer('{"answer": "Yes.", "next_steps": ["one", "two"], "details": {"ec": 2.1}}');
    expect(parsed.format).toBe("json");
    expect(parsed.summary).toBe("Yes.");
    expect(parsed.sections.map((s) => [s.title, s.kind])).toEqual([
      ["Next steps", "do_now"],
      ["Details", "other"],
    ]);
  });
});

describe("parseAnswer — Markdown and text", () => {
  it("splits on headings, bold labels and known labels", () => {
    const md = [
      "Irrigate the east block this morning.",
      "",
      "### Why",
      "Moisture is 17%.",
      "",
      "**Do now**",
      "1. Open valve 3",
      "2. Check pressure",
      "",
      "Warnings: EC is climbing.",
      "",
      "Sources:",
      "- MME guide",
    ].join("\n");
    const parsed = parseAnswer(md);
    expect(parsed.format).toBe("markdown");
    expect(parsed.summary).toBe("Irrigate the east block this morning.");
    expect(parsed.sections.map((s) => s.kind)).toEqual(["why", "do_now", "warnings", "sources"]);
    expect(parsed.sections[1].ordered).toBe(true);
    expect(parsed.sections[2].text).toBe("EC is climbing.");
  });

  it("uses a Summary heading as the lead and ignores headings inside code", () => {
    const parsed = parseAnswer("## Summary\nAll good.\n\n```\n# not a heading\n```\n\n## Forecast\nDry week.");
    expect(parsed.summary).toBe("All good.\n\n```\n# not a heading\n```");
    expect(parsed.sections.map((s) => s.title)).toEqual(["Forecast"]);
  });

  it("leaves plain text alone", () => {
    const parsed = parseAnswer("Just water tomorrow.");
    expect(parsed).toEqual({ format: "text", summary: "Just water tomorrow.", sections: [], task: null });
  });
});

describe("previews and copy", () => {
  it("previews JSON answers by their summary", () => {
    expect(answerPreview(JSON.stringify(MODEL_ANSWER))).toBe(MODEL_ANSWER.summary);
    expect(answerPreview("Hello")).toBe("Hello");
  });

  it("turns JSON answers into readable Markdown", () => {
    const md = answerToMarkdown(JSON.stringify(MODEL_ANSWER));
    expect(md.startsWith(MODEL_ANSWER.summary)).toBe(true);
    expect(md).toContain("### Warnings\n- [Critical] **Salinity rising**");
    expect(md).toContain("### Recommendations\n1. [High] **Irrigate 25 mm** (Before 7 am) — Moisture is below 18%.");
    expect(md).not.toContain("{");
  });
});

describe("normalizeAiServicePayload", () => {
  const answer = (payload: unknown) => AiServiceChatResponseSchema.safeParse(normalizeAiServicePayload(payload));

  it("accepts the common response shapes", () => {
    expect(answer({ answer: "A" }).data?.answer).toBe("A");
    expect(answer({ response: "B", confidence: "0.8" }).data).toEqual({ answer: "B", confidence: 0.8, sources: undefined });
    expect(answer({ generated_text: "C" }).data?.answer).toBe("C");
    expect(answer([{ generated_text: "D" }]).data?.answer).toBe("D");
    expect(answer({ message: { role: "assistant", content: "E" } }).data?.answer).toBe("E");
    expect(answer({ choices: [{ message: { content: "F" } }] }).data?.answer).toBe("F");
    expect(answer({ content: [{ type: "text", text: "G" }] }).data?.answer).toBe("G");
  });

  it("wraps a bare model output object as the answer", () => {
    const res = answer(MODEL_ANSWER);
    expect(res.success).toBe(true);
    expect(parseAnswer(res.data!.answer).format).toBe("model-json");
  });

  it("serialises a structured answer field and rejects empty answers", () => {
    const res = answer({ answer: { summary: "S", warnings: [], insights: [] } });
    expect(res.success).toBe(true);
    expect(parseAnswer(res.data!.answer).summary).toBe("S");
    expect(answer({ answer: "  " }).success).toBe(false);
    expect(answer({}).success).toBe(false);
  });
});
