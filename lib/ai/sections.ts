/**
 * Splits an answer from the fine-tuned model (or any source) into sections — summary,
 * diagnosis, actions, irrigation, salinity, … — with plain rules, no model call. It reads, in
 * order of preference:
 *
 *  1. JSON answers: `{ "summary": "…", "recommendations": [...] }` (keys mapped to sections).
 *  2. Headings the model wrote: `## Irrigation`, `**Irrigation**`, `**Irrigation:** text`,
 *     `Irrigation:` on its own line, `IRRIGATION`, or a numbered title such as `2. Diagnosis`.
 *  3. Otherwise the structure of the text: the opening paragraph is the summary, lists of
 *     instructions are actions, and other paragraphs (or, for one long paragraph, sentences) are
 *     classified by what they talk about.
 *
 * Section bodies stay in the chat's Markdown subset (paragraphs, lists, **bold**).
 */

export type SectionKind =
  | "summary"
  | "diagnosis"
  | "actions"
  | "irrigation"
  | "salinity"
  | "nutrients"
  | "crop"
  | "weather"
  | "risk"
  | "monitoring"
  | "data"
  | "other";

export interface AnswerSection {
  kind: SectionKind;
  title: string;
  /** Markdown subset: paragraphs, numbered / bulleted lists, **bold**. */
  body: string;
}

export const SECTION_TITLES: Record<SectionKind, string> = {
  summary: "Summary",
  diagnosis: "Diagnosis",
  actions: "Recommended actions",
  irrigation: "Irrigation",
  salinity: "Salinity",
  nutrients: "Nutrients & pH",
  crop: "Crop & market",
  weather: "Weather",
  risk: "Risks",
  monitoring: "What to monitor",
  data: "Readings",
  other: "Details",
};

/** Exact heading phrases (normalised) for each kind. */
const SYNONYMS: Record<SectionKind, string[]> = {
  summary: [
    "summary", "overview", "tl dr", "tldr", "in short", "bottom line", "short answer", "answer", "key takeaway", "key takeaways",
    "status", "current status", "farm status", "executive summary", "conclusion", "conclusions", "headline", "at a glance",
  ],
  diagnosis: [
    "diagnosis", "analysis", "assessment", "cause", "causes", "likely cause", "likely causes", "root cause", "why", "explanation",
    "findings", "what is happening", "whats happening", "observations", "interpretation", "reasoning", "details",
  ],
  actions: [
    "recommendations", "recommendation", "recommended actions", "recommended action", "actions", "action", "action plan",
    "what to do", "what you should do", "next steps", "steps", "to do", "todo", "do first", "priorities", "action items",
    "suggestions", "advice", "plan", "immediate actions", "do this", "do now",
  ],
  irrigation: [
    "irrigation", "water", "watering", "water management", "irrigation schedule", "irrigation plan", "soil moisture", "moisture",
    "water balance", "water stress", "irrigation advice",
  ],
  salinity: ["salinity", "salt", "salts", "leaching", "soil salinity", "ec", "ece", "salinity management", "salinity risk"],
  nutrients: ["nutrients", "nutrition", "fertilizer", "fertiliser", "fertigation", "npk", "fertility", "soil fertility", "ph", "soil ph", "nutrients and ph", "nutrients ph"],
  crop: [
    "crop", "crops", "crop suggestion", "crop choice", "planting", "what to plant", "next season", "market", "crop recommendation",
    "variety", "crop and market", "crop market", "market outlook",
  ],
  weather: ["weather", "forecast", "climate", "weather outlook", "conditions", "evapotranspiration", "et0", "weather forecast", "next 12 hours"],
  risk: ["risk", "risks", "warning", "warnings", "alert", "alerts", "caution", "hazards", "threats", "concerns", "risk assessment", "risk level"],
  monitoring: ["monitoring", "follow up", "followup", "next check", "what to watch", "watch", "keep an eye on", "track", "what to monitor"],
  data: [
    "data", "readings", "key numbers", "key figures", "measurements", "numbers", "metrics", "sensor data", "probe data",
    "latest readings", "current readings", "key metrics",
  ],
  other: ["notes", "note", "other", "additional notes", "more"],
};

/** Keyword patterns for headings and paragraphs that are not an exact synonym. Order matters. */
const KEYWORDS: Array<[SectionKind, RegExp]> = [
  ["actions", /\b(recommend|action|what to do|next step|to-?do|advice|priorit|should you|steps?)\b/i],
  ["risk", /\b(risk|warn|alert|caution|danger|threat|concern|hazard)/i],
  ["salinity", /\b(salin|salt|leach|ec[ew]?|conductiv|sodic|maas|hoffman)/i],
  ["irrigation", /\b(irrigat|water(ing)?|moist|deficit|depletion|drip|raw|taw|ks)\b/i],
  ["nutrients", /\b(nutri|fertili[sz]|fertigat|npk|nitrogen|phosph|potass|ph\b|alkalin|acid)/i],
  ["crop", /\b(crop|plant(ing)?|market|season|variet|harvest|sow)/i],
  ["weather", /\b(weather|forecast|rain|wind|humid|temperat|heat|climate|et0|et₀|evapotrans|gust|storm|dust)/i],
  ["monitoring", /\b(monitor|follow[- ]?up|keep an eye|re-?check|track)/i],
  ["summary", /\b(summary|overview|status|in short|bottom line|conclu)/i],
  ["diagnosis", /\b(diagnos|analys|assess|cause|why|finding|explan|because|due to)/i],
  ["data", /\b(reading|data|number|figure|measure|probe|sensor)/i],
];

const IMPERATIVE =
  /^(apply|irrigate|add|check|inspect|flush|leach|reduce|increase|avoid|monitor|consider|switch|plant|use|test|sample|schedule|keep|install|repair|fix|clean|blend|split|water|fertili[sz]e|spray|harvest|cover|mulch|shade|measure|calibrate|replace|confirm|start|stop|move|re-?check|lower|raise|maintain|ensure|plan|prepare|record|verify|run|open|close|delay|postpone|skip|space|prune|rotate|drain|dig|lay|set|turn|limit|cut|boost|top up|topdress|side-?dress|do|don't|do not|never|always)\b/i;

const LIST_ITEM = /^\s*(\d+[.)]|[-•*])\s+/;

/** Labels that introduce a value ("ECe: 5.9 dS/m"), not a section. */
const VALUE_LABELS = new Set([
  "ec", "ece", "ecw", "ph", "npk", "n", "p", "k", "et0", "eto", "et₀", "etc", "kc", "ks", "taw", "raw", "dr", "moisture",
  "temperature", "soil temperature", "air temperature", "humidity", "wind", "rain", "water", "salt", "status", "yield",
  "yield loss", "depletion", "area", "crop", "soil", "date", "farm", "probe", "stage",
]);

function normalise(title: string): string {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9₀]+/g, " ")
    .trim();
}

/** The section kind a heading names, or null if it names nothing we know. */
export function kindForTitle(title: string, { exactOnly = false } = {}): SectionKind | null {
  const n = normalise(title);
  if (!n) return null;
  for (const [kind, words] of Object.entries(SYNONYMS) as Array<[SectionKind, string[]]>) {
    if (words.includes(n)) return kind;
  }
  if (exactOnly) return null;
  for (const [kind, re] of KEYWORDS) if (re.test(title)) return kind;
  return null;
}

function classifyText(text: string): SectionKind {
  let best: SectionKind = "other";
  let bestScore = 0;
  for (const [kind, re] of KEYWORDS) {
    const global = new RegExp(re.source, "gi");
    const score = text.match(global)?.length ?? 0;
    if (score > bestScore) {
      best = kind;
      bestScore = score;
    }
  }
  return best;
}

function cleanTitle(raw: string): string {
  const t = raw
    .replace(/^#+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/[:：\s]+$/, "")
    .trim();
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) return t.charAt(0) + t.slice(1).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Heading {
  title: string;
  /** Text after the heading on the same line ("**Irrigation:** apply 12 mm"). */
  rest: string;
}

/** Recognise a heading line; `rest` carries inline text after a "Label:" heading. */
export function parseHeading(line: string): Heading | null {
  const t = line.trim();
  if (!t || t.length > 120) return null;

  let m = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
  if (m) return { title: cleanTitle(m[1]), rest: "" };

  // **Title** or **Title:** alone on a line.
  m = /^\*\*([^*]{2,80}?)\*\*\s*:?\s*$/.exec(t);
  if (m && !/[.!?]$/.test(m[1].trim())) return { title: cleanTitle(m[1]), rest: "" };

  // **Label:** text  /  **Label**: text
  m = /^\*\*([^*]{2,80}?)(:?)\*\*(:?)\s+(\S.*)$/.exec(t);
  if (m && (m[2] || m[3])) {
    const label = m[1].trim();
    if (!VALUE_LABELS.has(normalise(label)) && kindForTitle(label) && wordCount(label) <= 8) return { title: cleanTitle(label), rest: m[4] };
    return null;
  }

  // ALL CAPS heading.
  m = /^([A-Z][A-Z0-9 &/,'()-]{3,60}?):?$/.exec(t);
  if (m && /[A-Z]{3}/.test(m[1]) && wordCount(m[1]) <= 6) return { title: cleanTitle(m[1]), rest: "" };

  // "Title:" alone on a line.
  m = /^([A-Z][A-Za-z0-9 ,&/()'’-]{1,60}):$/.exec(t);
  if (m && wordCount(m[1]) <= 7) return { title: cleanTitle(m[1]), rest: "" };

  // "Label: text" where the label is a known section name (not "ECe: 5.9 dS/m").
  m = /^([A-Z][A-Za-z &/-]{1,40}):\s+(\S.*)$/.exec(t);
  if (m && !VALUE_LABELS.has(normalise(m[1])) && kindForTitle(m[1], { exactOnly: true })) return { title: cleanTitle(m[1]), rest: m[2] };

  // "2. Diagnosis" / "3) Recommended actions:" — only exact section names, so list items stay list items.
  m = /^\d+[.)]\s+(.{2,50}?):?$/.exec(t);
  if (m && kindForTitle(m[1].replace(/\*\*/g, ""), { exactOnly: true })) return { title: cleanTitle(m[1]), rest: "" };

  return null;
}

function section(kind: SectionKind, title: string | null, lines: string[]): AnswerSection | null {
  const body = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return null;
  return { kind, title: title ?? SECTION_TITLES[kind], body };
}

// ---------------------------------------------------------------------------
// JSON answers
// ---------------------------------------------------------------------------

function stripFence(text: string): string {
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text.trim());
  return m ? m[1] : text;
}

function jsonValueToMarkdown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item, i) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const title = o.title ?? o.action ?? o.name ?? o.crop ?? o.step;
          const detail = o.detail ?? o.details ?? o.description ?? o.reason ?? o.why ?? "";
          const priority = typeof o.priority === "string" ? ` (${o.priority} priority)` : "";
          if (title) return `${i + 1}. **${String(title).trim()}**${priority}${detail ? ` — ${String(detail).trim()}` : ""}`;
          return `${i + 1}. ${Object.entries(o).map(([k, v]) => `${k.replace(/_/g, " ")}: ${jsonValueToMarkdown(v)}`).join("; ")}`;
        }
        return `${i + 1}. ${jsonValueToMarkdown(item)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `**${cleanTitle(k.replace(/_/g, " "))}:** ${jsonValueToMarkdown(v)}`)
      .join("\n\n");
  }
  return "";
}

function fromJson(text: string): AnswerSection[] | null {
  const raw = stripFence(text).trim();
  if (!raw.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  // { "answer": "…markdown…" } — split the text itself.
  const keys = Object.keys(obj);
  const textKey = keys.find((k) => ["answer", "response", "text", "message"].includes(k));
  if (textKey && typeof obj[textKey] === "string" && keys.length <= 3) return splitAnswer(obj[textKey] as string);

  const out: AnswerSection[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (["confidence", "sources", "model", "farm_id", "id", "created_at"].includes(key)) continue;
    const title = cleanTitle(key.replace(/_/g, " "));
    const kind = kindForTitle(title) ?? "other";
    const s = section(kind, kind === "other" ? title : SECTION_TITLES[kind], [jsonValueToMarkdown(value)]);
    if (s) out.push(s);
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Unlabelled text
// ---------------------------------------------------------------------------

function isListBlock(lines: string[]): boolean {
  const items = lines.filter((l) => LIST_ITEM.test(l));
  return items.length >= 2 && items.length >= lines.length - 1;
}

function listIsActions(lines: string[]): boolean {
  const items = lines.filter((l) => LIST_ITEM.test(l)).map((l) => l.replace(LIST_ITEM, "").replace(/\*\*/g, "").trim());
  const imperative = items.filter((i) => IMPERATIVE.test(i)).length;
  return imperative >= Math.ceil(items.length / 2);
}

/** Sentences, split after . ! ? followed by a capital — so "5.9 dS/m" stays whole. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9*(“"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fromStructure(text: string): AnswerSection[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").filter((l) => l.trim() !== ""))
    .filter((b) => b.length > 0);

  // One long paragraph: split it by sentence.
  if (blocks.length === 1 && !isListBlock(blocks[0])) {
    const all = sentences(blocks[0].join(" "));
    const summary = all.slice(0, 2);
    const actions: string[] = [];
    const rest: Array<{ kind: SectionKind; text: string }> = [];
    for (const s of all.slice(2)) {
      if (IMPERATIVE.test(s.replace(/\*\*/g, ""))) actions.push(s);
      else rest.push({ kind: classifyText(s), text: s });
    }
    const out: AnswerSection[] = [];
    const push = (s: AnswerSection | null) => s && out.push(s);
    push(section("summary", null, [summary.join(" ")]));
    const grouped = new Map<SectionKind, string[]>();
    for (const r of rest) {
      const kind = r.kind === "summary" ? "diagnosis" : r.kind;
      grouped.set(kind, [...(grouped.get(kind) ?? []), r.text]);
    }
    for (const [kind, texts] of grouped) push(section(kind, null, [texts.join(" ")]));
    push(section("actions", null, actions.map((a, i) => `${i + 1}. ${a}`)));
    return out;
  }

  const raw: Array<{ kind: SectionKind; lines: string[] }> = [];
  blocks.forEach((lines, i) => {
    let kind: SectionKind;
    if (i === 0 && !isListBlock(lines)) kind = "summary";
    else if (isListBlock(lines)) kind = listIsActions(lines) ? "actions" : classifyText(lines.join(" "));
    else kind = classifyText(lines.join(" "));
    if (i > 0 && kind === "summary") kind = "diagnosis";
    raw.push({ kind, lines });
  });
  // Merge neighbours of the same kind.
  const merged: typeof raw = [];
  for (const b of raw) {
    const last = merged.at(-1);
    if (last && last.kind === b.kind) last.lines.push("", ...b.lines);
    else merged.push({ kind: b.kind, lines: [...b.lines] });
  }
  return merged.map((b) => section(b.kind, null, b.lines)).filter((s): s is AnswerSection => s !== null);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Sections of an answer. A short answer with no structure comes back as a single "summary"
 * section, so callers can render it as plain text.
 */
export function splitAnswer(answer: string): AnswerSection[] {
  const text = answer.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const json = fromJson(text);
  if (json) return json;

  const lines = text.split("\n");
  const headings = lines.map(parseHeading);
  if (headings.some(Boolean)) {
    const out: AnswerSection[] = [];
    let current: { kind: SectionKind; title: string | null; lines: string[] } = { kind: "summary", title: null, lines: [] };
    const flush = () => {
      const s = section(current.kind, current.title, current.lines);
      if (s) out.push(s);
    };
    lines.forEach((line, i) => {
      const h = headings[i];
      if (!h) {
        current.lines.push(line);
        return;
      }
      flush();
      const kind = kindForTitle(h.title) ?? (h.rest ? classifyText(h.rest) : "other");
      current = { kind, title: h.title, lines: h.rest ? [h.rest] : [] };
    });
    flush();
    // Text before the first heading is the summary; a lone heading-less answer falls through below.
    if (out.length > 1 || (out.length === 1 && out[0].title !== SECTION_TITLES.summary)) return out;
  }

  // A short answer (one paragraph of a few sentences) reads best as it is.
  if (!/\n\s*\n/.test(text) && (text.length <= 400 || sentences(text).length < 5)) {
    return [{ kind: "summary", title: SECTION_TITLES.summary, body: text }];
  }
  return fromStructure(text);
}

/** True when the answer has real structure worth showing as separate sections. */
export function isSectioned(sections: AnswerSection[]): boolean {
  return sections.length >= 2;
}
