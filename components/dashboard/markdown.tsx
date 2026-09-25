/**
 * Tiny, safe renderer for the chat's Markdown subset: section headings (`### Why`), paragraphs,
 * numbered / bulleted lists and **bold**. Builds React elements — never injects HTML.
 */
import { Fragment } from "react";

const LIST_ITEM = /^\s*(\d+[.)]|[-•*])\s+/;
const HEADING = /^\s*#{1,4}\s+/;

function inline(text: string, keyPrefix: string) {
  // While an answer is being typed, hide a dangling "**" until its partner arrives.
  const pairs = text.match(/\*\*/g)?.length ?? 0;
  const safe = pairs % 2 === 1 ? text.slice(0, text.lastIndexOf("**")) + text.slice(text.lastIndexOf("**") + 2) : text;
  return safe.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
    ),
  );
}

function List({ lines, ordered, keyPrefix }: { lines: string[]; ordered: boolean; keyPrefix: string }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={ordered ? "list-decimal space-y-1 pl-5 marker:text-muted-foreground" : "list-disc space-y-1 pl-5 marker:text-muted-foreground"}>
      {lines.map((line, i) => (
        <li key={i} className="pl-0.5">
          {inline(line.replace(LIST_ITEM, ""), `${keyPrefix}-${i}`)}
        </li>
      ))}
    </Tag>
  );
}

/** Answers label their sections with `### Heading` lines; each heading becomes its own block. */
function splitBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => block.split(/\n(?=\s*#{1,4}\s)/))
    .flatMap((block) => {
      const [first, ...rest] = block.split("\n");
      return HEADING.test(first) && rest.some((l) => l.trim()) ? [first, rest.join("\n")] : [block];
    });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className={className ?? "space-y-2"}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        if (lines.length === 1 && HEADING.test(lines[0])) {
          return (
            <p key={bi} role="heading" aria-level={4} className="pt-1 font-semibold text-foreground">
              {inline(lines[0].replace(HEADING, "").replace(/\*\*/g, ""), `${bi}-h`)}
            </p>
          );
        }
        const firstItem = lines.findIndex((l) => LIST_ITEM.test(l));
        const restAreItems = firstItem >= 0 && lines.slice(firstItem).every((l) => LIST_ITEM.test(l));
        if (restAreItems) {
          const ordered = /^\s*\d/.test(lines[firstItem]);
          const lead = lines.slice(0, firstItem);
          return (
            <div key={bi} className="space-y-1">
              {lead.length > 0 ? <p>{inline(lead.join(" "), `${bi}-lead`)}</p> : null}
              <List lines={lines.slice(firstItem)} ordered={ordered} keyPrefix={`${bi}`} />
            </div>
          );
        }
        return <p key={bi}>{inline(lines.join(" "), `${bi}`)}</p>;
      })}
    </div>
  );
}
