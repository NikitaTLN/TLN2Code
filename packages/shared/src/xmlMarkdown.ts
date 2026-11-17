import { SaxesParser } from "saxes";

export const isXmlPreviewFile = (path: string): boolean =>
  /\.(?:xml|xsd|xsl|xslt|plist|rss|atom|wsdl|xaml)$/i.test(path);

type XmlNode =
  | { readonly kind: "text"; text: string }
  | { readonly kind: "comment"; readonly text: string }
  | {
      readonly kind: "element";
      readonly name: string;
      readonly attributes: ReadonlyArray<readonly [string, string]>;
      readonly children: XmlNode[];
    };

const LIST_ITEM_MAX_LENGTH = 120;

function parseXml(source: string): XmlNode[] {
  const text = source.replace(/^\uFEFF/, "");
  // Fragment mode accepts prompt-style files with several top-level tags, but
  // rejects declarations and doctypes, which only a full document may carry.
  const parser = new SaxesParser({ fragment: !/^\s*<[?!]/.test(text) });
  const root: XmlNode[] = [];
  const stack: XmlNode[][] = [root];
  const appendText = (value: string) => {
    const siblings = stack.at(-1)!;
    const last = siblings.at(-1);
    if (last?.kind === "text") last.text += value;
    else siblings.push({ kind: "text", text: value });
  };
  parser.on("opentag", (tag) => {
    const children: XmlNode[] = [];
    stack.at(-1)!.push({
      kind: "element",
      name: tag.name,
      attributes: Object.entries(tag.attributes as Record<string, string>),
      children,
    });
    stack.push(children);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("comment", (comment) => {
    stack.at(-1)!.push({ kind: "comment", text: comment });
  });
  parser.write(text).close();
  return root;
}

/** Strips edge blank lines and shared indentation so indented XML text doesn't read as a code block. */
function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // Text that starts on the tag's own line has no indentation of its own to compare.
  const head = lines[0]!.trim() === "" ? "" : lines.shift()!.trim();
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  const body = lines.map((line) => line.slice(indent).trimEnd());
  return (head === "" ? body : [head, ...body]).join("\n");
}

function inlineCode(value: string): string {
  const longestRun = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

const escapeName = (name: string) => name.replace(/[\\_*]/g, "\\$&");

function attributeList(attributes: ReadonlyArray<readonly [string, string]>): string {
  return attributes
    .map(([key, value]) => inlineCode(`${key}="${value.replace(/\s+/g, " ")}"`))
    .join(" ");
}

function render(nodes: readonly XmlNode[], depth: number, blocks: string[]) {
  // Adjacent short leaves form one tight list.
  let list: string[] = [];
  const flushList = () => {
    if (list.length > 0) blocks.push(list.join("\n"));
    list = [];
  };
  for (const node of nodes) {
    if (node.kind === "text") {
      const text = dedent(node.text);
      if (text === "") continue;
      flushList();
      blocks.push(text);
      continue;
    }
    if (node.kind === "comment") {
      const text = dedent(node.text);
      if (text === "") continue;
      flushList();
      blocks.push(
        text
          .split("\n")
          .map((line) => `> ${line}`.trimEnd())
          .join("\n"),
      );
      continue;
    }
    const isLeaf = node.children.every((child) => child.kind === "text");
    const text = isLeaf ? dedent(node.children.map((child) => child.text).join("")) : "";
    const attributes = attributeList(node.attributes);
    if (isLeaf && !text.includes("\n") && text.length <= LIST_ITEM_MAX_LENGTH) {
      list.push(
        `- **${escapeName(node.name)}**${attributes ? ` ${attributes}` : ""}${text ? `: ${text}` : ""}`,
      );
      continue;
    }
    flushList();
    blocks.push(
      depth < 6
        ? `${"#".repeat(depth + 1)} ${escapeName(node.name)}`
        : `**${escapeName(node.name)}**`,
    );
    if (attributes) blocks.push(attributes);
    render(node.children, depth + 1, blocks);
  }
  flushList();
}

/**
 * Renders XML as a Markdown document: elements become headings or list items,
 * attributes inline code, and text stays Markdown, so tagged prompts read as prose.
 */
export function xmlToMarkdown(source: string): string {
  let nodes: XmlNode[];
  try {
    nodes = parseXml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fence = "`".repeat(
      Math.max(3, ...(source.match(/`{3,}/g) ?? []).map((run) => run.length + 1)),
    );
    return `> **This XML could not be rendered:** ${message}\n\n${fence}xml\n${source}\n${fence}`;
  }
  const blocks: string[] = [];
  render(nodes, 0, blocks);
  return blocks.join("\n\n");
}

const TAG_NAME = String.raw`[A-Za-z_][\w.:-]*`;
const TAG_ATTRIBUTES = String.raw`(?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*`;
const PROMPT_OPEN_LINE = new RegExp(String.raw`^\s*<(${TAG_NAME})(${TAG_ATTRIBUTES})\s*>\s*$`);
const PROMPT_CLOSE_LINE = new RegExp(String.raw`^\s*</(${TAG_NAME})\s*>\s*$`);
const PROMPT_LEAF_LINE = new RegExp(
  String.raw`^\s*<(${TAG_NAME})(${TAG_ATTRIBUTES})\s*>(.*?)</(${TAG_NAME})\s*>\s*$`,
);
const FENCE_LINE = /^\s*(`{3,}|~{3,})/;
// HTML pasted outside a code fence stays literal, and T3's own context blocks
// (composerContextLegacy) keep their delimiters for the parsers that read them.
const LITERAL_TAGS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas " +
    "caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed " +
    "fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i " +
    "iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript " +
    "object ol optgroup option output p picture pre progress q rp rt ruby s samp script search " +
    "section select slot small source span strong style sub summary sup svg table tbody td " +
    "template textarea tfoot th thead time title tr track u ul var video wbr " +
    "review_comment terminal_context element_context preview_annotation"
  ).split(" "),
);

const isPromptTag = (name: string) => !LITERAL_TAGS.has(name.toLowerCase());
const indentOf = (line: string) => line.length - line.trimStart().length;

function parseAttributes(source: string): Array<readonly [string, string]> {
  return [...source.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
    (match) => [match[1]!, match[2] ?? match[3] ?? ""] as const,
  );
}

/**
 * Renders prompt-style XML tags in a chat message as Markdown sections, the way
 * {@link xmlToMarkdown} renders files. Unlike files, a prompt is free text, so
 * only tags alone on their lines with a matching close render; everything else,
 * including code fences, stays as written.
 */
export function xmlPromptToMarkdown(text: string): string {
  if (!text.includes("</")) return text;
  const lines = text.split(/\r?\n/);
  const fenced: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence === null && marker) {
      fence = marker;
      fenced.push(true);
    } else if (fence !== null) {
      fenced.push(true);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else {
      fenced.push(false);
    }
  }

  // Pair opens with closes first, so an unclosed tag stays literal.
  const closeOf = new Map<number, number>();
  const open: Array<{ name: string; line: number }> = [];
  lines.forEach((line, index) => {
    if (fenced[index]) return;
    const opening = PROMPT_OPEN_LINE.exec(line);
    if (opening && isPromptTag(opening[1]!)) {
      open.push({ name: opening[1]!, line: index });
      return;
    }
    const closing = PROMPT_CLOSE_LINE.exec(line)?.[1];
    if (!closing) return;
    const match = open.findLastIndex((entry) => entry.name === closing);
    if (match < 0) return;
    closeOf.set(open[match]!.line, index);
    open.length = match;
  });

  const out: string[] = [];
  const blank = () => {
    if (out.length > 0 && out.at(-1) !== "") out.push("");
  };
  const sections: Array<{ close: number; indent: number }> = [];
  let changed = false;
  let afterLeaf = false;
  // Source blank lines stay as written (indented code keeps them); only spacing
  // the converter inserted absorbs the blank lines that follow it.
  let insertedGap = false;
  lines.forEach((line, index) => {
    const close = closeOf.get(index);
    if (close !== undefined) {
      const opening = PROMPT_OPEN_LINE.exec(line)!;
      const depth = sections.length;
      const body = lines.slice(index + 1, close).filter((inner) => inner.trim() !== "");
      const attributes = attributeList(parseAttributes(opening[2]!));
      blank();
      out.push(
        depth < 6
          ? `${"#".repeat(depth + 1)} ${escapeName(opening[1]!)}`
          : `**${escapeName(opening[1]!)}**`,
        "",
      );
      if (attributes) out.push(attributes, "");
      sections.push({ close, indent: Math.min(...body.map(indentOf), Infinity) });
      changed = true;
      afterLeaf = false;
      insertedGap = true;
      return;
    }
    if (sections.at(-1)?.close === index) {
      sections.pop();
      blank();
      afterLeaf = false;
      insertedGap = true;
      return;
    }
    const strip = Math.min(sections.at(-1)?.indent ?? 0, indentOf(line));
    const content = line.slice(strip);
    const leaf = fenced[index] ? null : PROMPT_LEAF_LINE.exec(content);
    if (leaf && leaf[1] === leaf[4] && isPromptTag(leaf[1]!) && !/<\/?[A-Za-z_]/.test(leaf[3]!)) {
      const attributes = attributeList(parseAttributes(leaf[2]!));
      const value = leaf[3]!.trim();
      out.push(
        `- **${escapeName(leaf[1]!)}**${attributes ? ` ${attributes}` : ""}${value ? `: ${value}` : ""}`,
      );
      changed = true;
      afterLeaf = true;
      insertedGap = false;
      return;
    }
    if (insertedGap && content.trim() === "") return;
    // Prose straight after a generated list item would continue that item.
    if (afterLeaf && content.trim() !== "") out.push("");
    afterLeaf = false;
    insertedGap = false;
    out.push(content);
  });
  if (insertedGap) while (out.at(-1) === "") out.pop();
  return changed ? out.join("\n") : text;
}
