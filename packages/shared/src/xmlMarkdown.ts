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
