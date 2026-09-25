/**
 * Splits an assistant answer into sections with plain code — no model involved — so every answer
 * renders the same way whoever wrote it:
 *
 *  1. The fine-tuned model's JSON (lib/dataset/schema.ts OUTPUT_KEYS: summary, insights, warnings,
 *     forecast, economic_advice, recommendations, crop_plan, sources, data_gaps), also when it is
 *     wrapped in a ```json fence, surrounded by text, double-encoded, has trailing commas or was cut
 *     off mid-object.
 *  2. The report JSON (contract.ts FarmReport: risk_score, summary, insights, warnings, forecast,
 *     economics, harvest, recommendations, crop_suggestion).
 *  3. Any other JSON object: one section per key.
 *  4. Markdown or plain text: sections start at "### Heading" lines, whole-line **bold** labels, or
 *     known labels such as "Warnings:" / "2. Recommendations". Text before the first one is the lead.
 *
 * Client-safe and pure: the chat renders with it, the chat history uses it for previews and copy.
 */

export type SectionKind =
  | "summary"
  | "insights"
  | "why"
  | "warnings"
  | "do_now"
  | "recommendations"
  | "forecast"
  | "economics"
  | "harvest"
  | "crop_plan"
  | "sources"
  | "data_gaps"
  | "other";

export type BadgeTone = "critical" | "warning" | "watch" | "high" | "medium" | "low" | "good" | "avoid" | "neutral";

export interface SectionItem {
  title?: string;
  detail?: string;
  /** Short label shown as a chip, e.g. "Critical" or "High". */
  badge?: { label: string; tone: BadgeTone };
  /** When or how: "Today", "Before 7 am", "Greenhouse". */
  meta?: string;
  /** A link (sources). */
  href?: string;
  /** Evidence ids the item cites. */
  cites?: string[];
}

export interface SectionRow {
  label: string;
  value: string;
  detail?: string;
}

export interface AnswerSection {
  kind: SectionKind;
  title: string;
  /** Markdown text (paragraphs, lists). */
  text?: string;
  items?: SectionItem[];
  rows?: SectionRow[];
  /** Numbered list (recommendations, "Do now"). */
  ordered?: boolean;
}

export interface ParsedAnswer {
  format: "model-json" | "report-json" | "json" | "markdown" | "text";
  /** The direct answer, shown first. */
  summary: string | null;
  sections: AnswerSection[];
  /** land_analysis / farm_analysis for the fine-tuned model's answers. */
  task: string | null;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/** The first balanced {...} in `text` (strings and escapes respected), or the unterminated tail. */
function scanObject(text: string, start: number): { body: string; complete: boolean } {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return { body: text.slice(start, i + 1), complete: true };
    }
  }
  return { body: text.slice(start), complete: false };
}

/** Close whatever a cut-off answer left open: a string, then arrays and objects, innermost first. */
function closeTruncated(body: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const c of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = body;
  if (escaped) out = out.slice(0, -1);
  if (inString) out += '"';
  // A dangling key or separator can't be closed meaningfully: cut back to the last complete value.
  out = out
    .replace(/,\s*"[^"]*"\s*:?\s*$/, "")
    .replace(/\{\s*"[^"]*"\s*:?\s*$/, "{")
    .replace(/[,:]\s*$/, "");
  return out + stack.reverse().join("");
}

const withoutTrailingCommas = (s: string) => s.replace(/,(\s*[}\]])/g, "$1");

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(withoutTrailingCommas(s));
    } catch {
      return undefined;
    }
  }
}

/** Find a JSON object in an answer. Returns null when the answer isn't JSON. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  if (!text) return null;
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)(?:```|$)/.exec(text);
  if (fence && fence[1].includes("{")) text = fence[1].trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  // Prose answers can contain braces; only treat it as JSON when the object is (nearly) the whole answer
  // or clearly starts with a key.
  const head = text.slice(start, start + 40);
  if (!/^\{\s*("|\n|$)/.test(head)) return null;
  const { body, complete } = scanObject(text, start);
  let value = tryParse(body);
  if (value === undefined && !complete) value = tryParse(closeTruncated(body));
  if (typeof value === "string" && value.trim().startsWith("{")) value = tryParse(value);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A JSON-encoded answer string (e.g. `"{\"summary\": …}"`) decoded once. */
function unwrapEncoded(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    const decoded = tryParse(t);
    if (typeof decoded === "string") return decoded;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Lenient field readers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const pick = (o: Obj, ...keys: string[]) => {
  for (const k of keys) {
    const s = str(o[k]);
    if (s) return s;
  }
  return "";
};
const strings = (v: unknown): string[] => arr(v).map((x) => (isObj(x) ? pick(x, "text", "title", "detail", "id") : str(x))).filter(Boolean);

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const humanKey = (k: string) => cap(k.replace(/[_-]+/g, " ").trim());

function severityBadge(v: unknown): SectionItem["badge"] {
  const s = str(v).toLowerCase();
  if (s.startsWith("crit") || s === "high" || s === "severe") return { label: "Critical", tone: "critical" };
  if (s.startsWith("warn") || s === "medium") return { label: "Warning", tone: "warning" };
  if (s) return { label: "Watch", tone: "watch" };
  return undefined;
}

function priorityBadge(v: unknown): SectionItem["badge"] {
  const s = str(v).toLowerCase();
  if (s === "high" || s === "urgent" || s === "critical") return { label: "High", tone: "high" };
  if (s === "medium" || s === "normal") return { label: "Medium", tone: "medium" };
  if (s === "low") return { label: "Low", tone: "low" };
  return undefined;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, watch: 2 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Anything → readable text (for unknown keys): strings, lists and small objects. */
function flatten(v: unknown, depth = 0): string {
  if (v == null) return "";
  if (typeof v !== "object") return str(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x ? `- ${flatten(x, depth + 1).replace(/\n/g, " ")}` : `- ${str(x)}`)).join("\n");
  const entries = Object.entries(v as Obj).filter(([, x]) => x != null && x !== "");
  if (depth > 0) return entries.map(([k, x]) => `${humanKey(k)}: ${typeof x === "object" ? flatten(x, depth + 1).replace(/\n- /g, "; ").replace(/^- /, "") : str(x)}`).join(" · ");
  return entries.map(([k, x]) => `**${humanKey(k)}:** ${typeof x === "object" ? flatten(x, depth + 1) : str(x)}`).join("\n");
}

// ---------------------------------------------------------------------------
// Sections from the model's JSON (both shapes share many keys)
// ---------------------------------------------------------------------------

function insightsSection(v: unknown, title = "Insights"): AnswerSection | null {
  const items: SectionItem[] = arr(v)
    .map((x): SectionItem | null => {
      if (!isObj(x)) return str(x) ? { detail: str(x) } : null;
      const cites = strings(x.sources ?? x.citations ?? x.evidence);
      return { title: pick(x, "title", "finding", "headline"), detail: pick(x, "detail", "text", "description", "why"), cites: cites.length ? cites : undefined };
    })
    .filter((x): x is SectionItem => Boolean(x && (x.title || x.detail)));
  return items.length ? { kind: "insights", title, items } : null;
}

function warningsSection(v: unknown): AnswerSection | null {
  const items = arr(v)
    .map((x): (SectionItem & { order: number }) | null => {
      if (!isObj(x)) return str(x) ? { detail: str(x), order: 3 } : null;
      const badge = severityBadge(x.severity ?? x.level);
      const action = pick(x, "action", "what_to_do");
      const detail = [pick(x, "detail", "text", "description"), action ? `**Action:** ${action}` : ""].filter(Boolean).join("\n");
      return { title: pick(x, "title", "warning", "headline"), detail, badge, meta: pick(x, "when", "window", "timing") || undefined, order: SEVERITY_ORDER[badge?.tone ?? ""] ?? 3 };
    })
    .filter((x): x is SectionItem & { order: number } => Boolean(x && (x.title || x.detail)))
    .sort((a, b) => a.order - b.order)
    .map(({ order: _o, ...item }) => item);
  return items.length ? { kind: "warnings", title: "Warnings", items } : null;
}

function recommendationsSection(v: unknown): AnswerSection | null {
  const items = arr(v)
    .map((x, i): (SectionItem & { order: number }) | null => {
      if (!isObj(x)) return str(x) ? { title: str(x), order: 3 + i / 100 } : null;
      const badge = priorityBadge(x.priority);
      return {
        title: pick(x, "action", "title", "recommendation"),
        detail: pick(x, "why", "detail", "reason", "description") || undefined,
        meta: pick(x, "when", "timing") || undefined,
        badge,
        order: (PRIORITY_ORDER[badge?.tone ?? ""] ?? 3) + i / 100,
      };
    })
    .filter((x): x is SectionItem & { order: number } => Boolean(x && (x.title || x.detail)))
    .sort((a, b) => a.order - b.order)
    .map(({ order: _o, ...item }) => item);
  return items.length ? { kind: "recommendations", title: "Recommendations", items, ordered: true } : null;
}

function forecastSection(v: unknown): AnswerSection | null {
  if (typeof v === "string") return v.trim() ? { kind: "forecast", title: "Forecast", text: v.trim() } : null;
  if (!isObj(v)) return null;
  const rows: SectionRow[] = [];
  const labels: Array<[string, string]> = [
    ["next_7_days", "Next 7 days"],
    ["next_12_hours", "Next 12 hours"],
    ["season_ahead", "Season ahead"],
    ["long_term", "Long term"],
  ];
  for (const [key, label] of labels) if (str(v[key])) rows.push({ label, value: str(v[key]) });
  const days = arr(v.days)
    .filter(isObj)
    .map((d): SectionItem => {
      const level = str(d.level).toLowerCase();
      return {
        title: pick(d, "label", "summary"),
        meta: pick(d, "date", "day") || undefined,
        badge: level === "warning" ? { label: "Warning", tone: "warning" } : level === "watch" ? { label: "Watch", tone: "watch" } : undefined,
      };
    })
    .filter((d) => d.title || d.meta);
  const text = pick(v, "summary", "text");
  const known = new Set(["summary", "text", "days", ...labels.map(([k]) => k)]);
  for (const [k, x] of Object.entries(v)) if (!known.has(k) && str(x)) rows.push({ label: humanKey(k), value: str(x) });
  if (!text && rows.length === 0 && days.length === 0) return null;
  return { kind: "forecast", title: "Forecast", text: text || undefined, rows: rows.length ? rows : undefined, items: days.length ? days : undefined };
}

function economicsSection(v: unknown): AnswerSection | null {
  if (typeof v === "string") return v.trim() ? { kind: "economics", title: "Economics", text: v.trim() } : null;
  if (!isObj(v)) return null;
  const rows = [...arr(v.figures), ...arr(v.lines)]
    .filter(isObj)
    .map((f): SectionRow => ({ label: pick(f, "label", "name"), value: pick(f, "value", "amount"), detail: pick(f, "basis", "detail", "note") || undefined }))
    .filter((r) => r.label && r.value);
  const advice = strings(v.advice);
  const assumptions = strings(v.assumptions);
  const items: SectionItem[] = [...advice.map((a) => ({ detail: a })), ...assumptions.map((a) => ({ detail: a, meta: "Assumption" }))];
  const text = pick(v, "summary", "text");
  if (!text && rows.length === 0 && items.length === 0) return null;
  return { kind: "economics", title: "Economics", text: text || undefined, rows: rows.length ? rows : undefined, items: items.length ? items : undefined };
}

function cropPlanSection(v: unknown): AnswerSection | null {
  if (!isObj(v)) return typeof v === "string" && v.trim() ? { kind: "crop_plan", title: "Crop plan", text: v.trim() } : null;
  const grow = arr(v.recommended ?? v.grow)
    .map((x): SectionItem | null => {
      if (!isObj(x)) return str(x) ? { title: str(x), badge: { label: "Grow", tone: "good" } } : null;
      const crop = pick(x, "crop", "name");
      const type = pick(x, "farm_type", "system", "type");
      return { title: crop, meta: type || undefined, detail: pick(x, "why", "reason") || undefined, badge: { label: "Grow", tone: "good" } };
    })
    .filter((x): x is SectionItem => Boolean(x?.title));
  const avoid = arr(v.avoid)
    .map((x): SectionItem | null => {
      if (!isObj(x)) return str(x) ? { title: str(x), badge: { label: "Avoid", tone: "avoid" } } : null;
      return { title: pick(x, "crop", "name"), detail: pick(x, "why", "reason") || undefined, badge: { label: "Avoid", tone: "avoid" } };
    })
    .filter((x): x is SectionItem => Boolean(x?.title));
  const items = [...grow, ...avoid];
  return items.length ? { kind: "crop_plan", title: "Crop plan", items } : null;
}

function sourcesSection(v: unknown): AnswerSection | null {
  const items = arr(v)
    .map((x): SectionItem | null => {
      if (!isObj(x)) {
        const s = str(x);
        if (!s) return null;
        return /^https?:\/\//i.test(s) ? { title: s, href: s } : { title: s };
      }
      const url = pick(x, "url", "link", "href");
      const id = pick(x, "id");
      return { title: pick(x, "title", "name") || url || id, href: /^https?:\/\//i.test(url) ? url : undefined, meta: id || undefined };
    })
    .filter((x): x is SectionItem => Boolean(x?.title));
  return items.length ? { kind: "sources", title: "Sources", items } : null;
}

function listSection(kind: SectionKind, title: string, v: unknown): AnswerSection | null {
  const items = strings(v).map((detail) => ({ detail }));
  return items.length ? { kind, title, items } : null;
}

function harvestSection(v: unknown): AnswerSection | null {
  if (!isObj(v)) return typeof v === "string" && v.trim() ? { kind: "harvest", title: "Harvest & next crop", text: v.trim() } : null;
  const rows: SectionRow[] = [];
  if (str(v.status)) rows.push({ label: "Status", value: cap(str(v.status)) });
  const w = isObj(v.window) ? v.window : null;
  if (w && str(w.start)) rows.push({ label: "Harvest window", value: str(w.end) ? `${str(w.start)} – ${str(w.end)}` : `from ${str(w.start)}` });
  const items = arr(v.next_crops)
    .filter(isObj)
    .map((c): SectionItem => ({ title: pick(c, "crop"), detail: pick(c, "reason") || undefined, meta: pick(c, "plant_window") || undefined, badge: { label: "Next", tone: "good" } }))
    .filter((c) => c.title);
  const text = pick(v, "summary");
  if (!text && rows.length === 0 && items.length === 0) return null;
  return { kind: "harvest", title: "Harvest & next crop", text: text || undefined, rows: rows.length ? rows : undefined, items: items.length ? items : undefined };
}

function cropSuggestionSection(v: unknown): AnswerSection | null {
  if (!isObj(v)) return null;
  const crop = pick(v, "crop");
  if (!crop) return null;
  const detail = [pick(v, "reason"), pick(v, "market_note")].filter(Boolean).join(" ");
  return { kind: "crop_plan", title: "Crop suggestion", items: [{ title: crop, detail: detail || undefined, badge: { label: "Suggested", tone: "good" } }] };
}

/** Unknown keys still get shown, one section each. */
function genericSection(key: string, v: unknown): AnswerSection | null {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  const title = humanKey(key);
  if (typeof v !== "object") return { kind: kindOfTitle(title), title, text: str(v) };
  if (Array.isArray(v) && v.every((x) => typeof x !== "object")) return { kind: kindOfTitle(title), title, items: v.map((x) => ({ detail: str(x) })) };
  if (Array.isArray(v)) {
    const items = v.filter(isObj).map((x) => {
      const t = pick(x, "title", "name", "label", "action", "crop");
      const rest = Object.fromEntries(Object.entries(x).filter(([k]) => !["title", "name", "label", "action", "crop"].includes(k)));
      return { title: t || undefined, detail: flatten(rest, 1) || undefined };
    });
    return items.length ? { kind: kindOfTitle(title), title, items } : null;
  }
  return { kind: kindOfTitle(title), title, text: flatten(v) };
}

const MODEL_KEYS = ["insights", "warnings", "forecast", "economic_advice", "recommendations", "crop_plan", "sources", "data_gaps"];
const REPORT_KEYS = ["risk_score", "risk_level", "economics", "harvest", "crop_suggestion"];
const LEAD_KEYS = ["summary", "answer", "response", "direct_answer", "text", "message"];

function fromObject(o: Obj): ParsedAnswer {
  const keys = Object.keys(o);
  const isModel = MODEL_KEYS.filter((k) => k in o).length >= 2 || ("task" in o && "summary" in o);
  const isReport = !isModel && REPORT_KEYS.some((k) => k in o) && "summary" in o;
  const leadKey = LEAD_KEYS.find((k) => typeof o[k] === "string" && str(o[k]));
  const summary = leadKey ? str(o[leadKey]) : null;
  const sections: AnswerSection[] = [];
  const used = new Set<string>(["task", ...(leadKey ? [leadKey] : [])]);
  const add = (key: string, s: AnswerSection | null) => {
    used.add(key);
    if (s) sections.push(s);
  };

  if (isModel || isReport) {
    if (isReport && (o.risk_score != null || o.risk_level != null)) {
      const level = str(o.risk_level).toLowerCase();
      const score = str(o.risk_score);
      used.add("risk_score");
      used.add("risk_level");
      if (level || score) {
        sections.push({
          kind: "summary",
          title: "Risk",
          rows: [{ label: "Risk", value: [cap(level), score ? `${Math.round(Number(score))}/100` : ""].filter(Boolean).join(" · ") }],
        });
      }
    }
    add("warnings", warningsSection(o.warnings));
    add("insights", insightsSection(o.insights));
    add("recommendations", recommendationsSection(o.recommendations));
    add("forecast", forecastSection(o.forecast));
    add("economic_advice", economicsSection(o.economic_advice));
    add("economics", economicsSection(o.economics));
    add("harvest", harvestSection(o.harvest));
    add("crop_plan", cropPlanSection(o.crop_plan));
    add("crop_suggestion", cropSuggestionSection(o.crop_suggestion));
    add("data_gaps", listSection("data_gaps", "Data gaps", o.data_gaps));
    add("sources", sourcesSection(o.sources));
  }
  for (const k of keys) if (!used.has(k)) add(k, genericSection(k, o[k]));
  // Data gaps, then sources, always last.
  const body = sections.filter((s) => s.kind !== "sources" && s.kind !== "data_gaps");
  const gaps = sections.filter((s) => s.kind === "data_gaps");
  const sources = sections.filter((s) => s.kind === "sources");
  return {
    format: isModel ? "model-json" : isReport ? "report-json" : "json",
    summary,
    sections: [...body, ...gaps, ...sources],
    task: str(o.task) || null,
  };
}

// ---------------------------------------------------------------------------
// Markdown / plain text
// ---------------------------------------------------------------------------

const TITLE_KINDS: Array<[RegExp, SectionKind]> = [
  [/^(summary|answer|in short|overview|tl;?dr|short answer|bottom line)$/i, "summary"],
  [/^(warnings?|alerts?|risks?|watch out|cautions?)$/i, "warnings"],
  [/^(do now|what to do( now| today)?|actions?|next steps|to do|steps)$/i, "do_now"],
  [/^(recommendations?|advice|what i recommend|suggestions?)$/i, "recommendations"],
  [/^(why|reasons?|evidence|the readings|readings|what the (data|readings) say|analysis)$/i, "why"],
  [/^(insights?|findings?|key findings|observations?)$/i, "insights"],
  [/^(forecast|outlook|next (7|seven) days|next 12 hours|weather|the week ahead|season ahead|long[- ]term)$/i, "forecast"],
  [/^(cost|costs|economics?|economic advice|money|budget|revenue|profit(ability)?)$/i, "economics"],
  [/^(harvest( & next crop| and next crop)?|next crop|harvest timing)$/i, "harvest"],
  [/^(crop plan|crops?( to grow)?|what to (grow|plant)|crop (choice|suggestions?)|land use)$/i, "crop_plan"],
  [/^(sources?|references?|citations?)$/i, "sources"],
  [/^(data gaps|limitations?|missing data|assumptions?|caveats?)$/i, "data_gaps"],
];

function kindOfTitle(title: string): SectionKind {
  const t = title.trim().replace(/[:.]+$/, "");
  for (const [re, kind] of TITLE_KINDS) if (re.test(t)) return kind;
  return "other";
}

const MD_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^\s*\*\*([^*]{2,60}?)\*\*\s*:?\s*$/;
/** "Warnings:" or "2. Recommendations:" with nothing (or text) after the colon, only for known titles. */
const LABEL_LINE = /^\s*(?:\d+[.)]\s*)?([A-Za-z][A-Za-z &/'-]{1,40}?)\s*:\s*(.*)$/;
/** "**Warnings:** text on the same line". */
const BOLD_LABEL = /^\s*\*\*([^*]{2,40}?)\s*:?\*\*\s*:?\s*(.*)$/;

interface Heading {
  title: string;
  rest: string;
}

function headingOf(line: string): Heading | null {
  const md = MD_HEADING.exec(line);
  if (md) return { title: md[1].replace(/\*\*/g, "").replace(/:$/, "").trim(), rest: "" };
  const bold = BOLD_LINE.exec(line);
  if (bold) return { title: bold[1].replace(/:$/, "").trim(), rest: "" };
  const boldLabel = BOLD_LABEL.exec(line);
  if (boldLabel && kindOfTitle(boldLabel[1]) !== "other") return { title: boldLabel[1].trim(), rest: boldLabel[2].trim() };
  const label = LABEL_LINE.exec(line);
  if (label && kindOfTitle(label[1]) !== "other") return { title: label[1].trim(), rest: label[2].trim() };
  return null;
}

function fromText(raw: string): ParsedAnswer {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const lead: string[] = [];
  const sections: Array<{ title: string; lines: string[] }> = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = inFence ? null : headingOf(line);
    if (h) {
      sections.push({ title: h.title, lines: h.rest ? [h.rest] : [] });
      continue;
    }
    if (sections.length) sections[sections.length - 1].lines.push(line);
    else lead.push(line);
  }
  const leadText = lead.join("\n").trim();
  if (sections.length === 0) return { format: "text", summary: leadText || null, sections: [], task: null };

  const out: AnswerSection[] = [];
  let summary = leadText || null;
  for (const s of sections) {
    const text = s.lines.join("\n").trim();
    const kind = kindOfTitle(s.title);
    if (!text) continue;
    if (kind === "summary" && !summary) {
      summary = text;
      continue;
    }
    const ordered = kind === "do_now" || (kind === "recommendations" && /^\s*\d+[.)]\s/m.test(text));
    out.push({ kind, title: cap(s.title), text, ordered: ordered || undefined });
  }
  return { format: "markdown", summary, sections: out, task: null };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function parseAnswer(raw: string): ParsedAnswer {
  const text = unwrapEncoded(raw ?? "");
  const json = extractJsonObject(text);
  if (json) {
    const parsed = fromObject(json);
    if (parsed.summary || parsed.sections.length) return parsed;
  }
  return fromText(text);
}

/** Is this answer JSON (so it should be revealed section by section, not typed out character by character)? */
export function isStructuredAnswer(raw: string): boolean {
  const t = unwrapEncoded(raw ?? "").trim();
  return /^(```(json)?\s*)?\{/i.test(t) && extractJsonObject(t) !== null;
}

/** One-line preview for chat history lists. */
export function answerPreview(raw: string): string {
  const parsed = parseAnswer(raw);
  if (parsed.format === "text" || parsed.format === "markdown") return raw;
  return parsed.summary ?? parsed.sections[0]?.text ?? parsed.sections[0]?.items?.[0]?.title ?? raw;
}

/** The answer as readable Markdown (copy button, the Claude fallback's history). */
export function answerToMarkdown(raw: string): string {
  const parsed = parseAnswer(raw);
  if (parsed.format === "text" || parsed.format === "markdown") return raw.trim();
  const out: string[] = [];
  if (parsed.summary) out.push(parsed.summary);
  for (const s of parsed.sections) {
    const block: string[] = [`### ${s.title}`];
    if (s.text) block.push(s.text);
    for (const r of s.rows ?? []) block.push(`- **${r.label}:** ${r.value}${r.detail ? ` (${r.detail})` : ""}`);
    (s.items ?? []).forEach((it, i) => {
      const bullet = s.ordered ? `${i + 1}.` : "-";
      const head = [it.badge ? `[${it.badge.label}]` : "", it.title ? `**${it.title}**` : "", it.meta ? `(${it.meta})` : ""].filter(Boolean).join(" ");
      const body = [head, it.detail?.replace(/\n+/g, " "), it.href && it.href !== it.title ? it.href : ""].filter(Boolean).join(" — ");
      block.push(`${bullet} ${body}`);
    });
    out.push(block.join("\n"));
  }
  return out.join("\n\n");
}
