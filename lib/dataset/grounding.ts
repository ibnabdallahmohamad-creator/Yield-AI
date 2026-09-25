/**
 * Checks every training example before it is written: the output matches the fixed schema with its
 * keys in order, all nine inputs are present, every citation points at an evidence item, and every
 * number in the answer appears in the input (so the model is never taught to invent figures).
 */
import { isInQatar } from "../qatar/location";
import { INPUT_KEYS, ModelOutputSchema, OUTPUT_KEYS, type ModelInput, type ModelOutput } from "./schema";

/** A number in prose: "12,345.6", "3.19", "45". Method names like "FAO-56" are not quantities. */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const NOT_QUANTITIES = /FAO-\d+|AgERA5|ERA5|\d{4}-\d{2}-\d{2}/g;

function numbersInText(text: string): string[] {
  return (text.replace(NOT_QUANTITIES, " ").match(NUMBER) ?? []).map((t) => String(Number(t.replace(/,/g, ""))));
}

/** Every number in a JSON value: numeric fields as they are, and numbers written inside strings. */
function numbersIn(value: unknown, out: string[] = []): string[] {
  // Prose writes signs as words or dashes ("changed by −1.4", "from 3 to 5"), so compare magnitudes.
  if (typeof value === "number") out.push(String(Math.abs(value)));
  else if (typeof value === "string") out.push(...numbersInText(value));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/** Small counts, months and years are allowed without appearing in the input. */
function allowed(n: string): boolean {
  const v = Number(n);
  return (Number.isInteger(v) && v >= 0 && v <= 12) || (Number.isInteger(v) && v >= 1979 && v <= 2035);
}

export function ungroundedNumbers(input: ModelInput, output: ModelOutput): string[] {
  const known = new Set(numbersIn(input));
  const { sources: _sources, ...rest } = output;
  void _sources;
  return [...new Set(numbersIn(rest).filter((x) => !known.has(x) && !allowed(x)))];
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** ISO dates are skipped by the number check, so check them on their own: each must be in the input. */
export function ungroundedDates(input: ModelInput, output: ModelOutput): string[] {
  const known = new Set(JSON.stringify(input).match(ISO_DATE) ?? []);
  const { sources: _sources, ...rest } = output;
  void _sources;
  return [...new Set((JSON.stringify(rest).match(ISO_DATE) ?? []).filter((d) => !known.has(d)))];
}

/** Other countries and regions. Qatar's own tariff rules name the GCC, so the GCC is allowed. */
const OTHER_PLACES = /\b(Saudi|UAE|Emirates|Dubai|Abu Dhabi|Bahrain|Oman|Kuwait|Iran|Iraq|Riyadh|Egypt|Jordan|India|Pakistan|Türkiye|Turkey|Gulf states|Gulf countries|Middle East|worldwide|world's)\b/gi;

/** The site must be in Qatar, and the answer (apart from source titles) must be about Qatar. */
export function regionIssues(input: ModelInput, output: ModelOutput): string[] {
  const issues: string[] = [];
  const lat = Number(input.inputs.latitude);
  const lng = Number(input.inputs.longitude);
  if (!isInQatar(lat, lng)) issues.push(`site ${lat},${lng} is outside Qatar`);
  const { sources: _sources, ...rest } = output;
  void _sources;
  for (const hit of new Set(JSON.stringify(rest).match(OTHER_PLACES) ?? [])) issues.push(`answer mentions ${hit}`);
  return issues;
}

export interface ExampleIssues {
  schema: string[];
  keys: string[];
  citations: string[];
  numbers: string[];
  /** Outside Qatar, or an answer that talks about another country. */
  region: string[];
}

export function checkExample(input: ModelInput, output: ModelOutput): ExampleIssues {
  const issues: ExampleIssues = { schema: [], keys: [], citations: [], numbers: [], region: [] };
  const parsed = ModelOutputSchema.safeParse(output);
  if (!parsed.success) issues.schema = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  if (Object.keys(output).join() !== OUTPUT_KEYS.join()) issues.keys.push(`output keys ${Object.keys(output).join()}`);
  if (Object.keys(input.inputs).join() !== INPUT_KEYS.join()) issues.keys.push(`input keys ${Object.keys(input.inputs).join()}`);
  for (const k of INPUT_KEYS) if (input.inputs[k] == null) issues.keys.push(`input ${k} missing`);

  const evidence = new Map(input.evidence.map((e) => [e.id, e]));
  const listed = new Set(output.sources.map((s) => s.id));
  for (const s of output.sources) {
    const e = evidence.get(s.id);
    if (!e) issues.citations.push(`source ${s.id} is not in the evidence`);
    else if (e.url !== s.url || e.title !== s.title) issues.citations.push(`source ${s.id} title/url differ from the evidence`);
  }
  for (const i of output.insights) {
    for (const id of i.sources) {
      if (!evidence.has(id)) issues.citations.push(`insight "${i.title}" cites ${id}, not in the evidence`);
      else if (!listed.has(id)) issues.citations.push(`insight "${i.title}" cites ${id}, missing from sources`);
    }
  }
  issues.numbers = [...ungroundedNumbers(input, output), ...ungroundedDates(input, output)];
  issues.region = regionIssues(input, output);
  return issues;
}

export const hasIssues = (i: ExampleIssues) => i.schema.length + i.keys.length + i.citations.length + i.numbers.length + i.region.length > 0;
