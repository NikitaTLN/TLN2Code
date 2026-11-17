import { describe, expect, it } from "vite-plus/test";

import { xmlPromptToMarkdown, xmlToMarkdown } from "./xmlMarkdown.ts";

describe("xmlToMarkdown", () => {
  it("renders nested elements as headings, short leaves as a list, and dedents text", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<!-- package manifest -->
<project name="t3">
  <version>1.0</version>
  <dependency id="effect" />
  <notes>
    Use **bold** here.

        indented code
  </notes>
</project>`;
    expect(xmlToMarkdown(source)).toBe(
      [
        "> package manifest",
        "# project",
        '`name="t3"`',
        '- **version**: 1.0\n- **dependency** `id="effect"`',
        "## notes",
        "Use **bold** here.\n\n    indented code",
      ].join("\n\n"),
    );
  });

  it("accepts prompt-style files with several top-level tags and loose text", () => {
    expect(
      xmlToMarkdown("Intro text\n<instructions>\n  Line one\n  Line two\n</instructions>\n<a_b/>"),
    ).toBe("Intro text\n\n# instructions\n\nLine one\nLine two\n\n- **a\\_b**");
  });

  it("falls back to the source with the parse error when the XML is malformed", () => {
    expect(xmlToMarkdown("<a><b></a>")).toBe(
      "> **This XML could not be rendered:** 1:10: unexpected close tag.\n\n```xml\n<a><b></a>\n```",
    );
  });
});

describe("xmlPromptToMarkdown", () => {
  it("renders prompt tags as nested sections and keeps their text as written", () => {
    const prompt = [
      "WARNING THIS IS A TEST",
      "",
      "<context>",
      "I have a React todo app.",
      "",
      "<error>",
      "Traceback (most recent call last):",
      '  File "app.py", line 88, in refresh',
      "</error>",
      '  <repo name="todo">t3code</repo>',
      "  <condition>x < 2</condition>",
      "Unrelated paragraph.",
      "</context>",
      "",
      "<instructions>",
      "    Inspect the code.",
      "</instructions>",
    ].join("\n");
    expect(xmlPromptToMarkdown(prompt)).toBe(
      [
        "WARNING THIS IS A TEST",
        "",
        "# context",
        "",
        "I have a React todo app.",
        "",
        "## error",
        "",
        "Traceback (most recent call last):",
        '  File "app.py", line 88, in refresh',
        "",
        '- **repo** `name="todo"`: t3code',
        "- **condition**: x < 2",
        "",
        "Unrelated paragraph.",
        "",
        "# instructions",
        "",
        "Inspect the code.",
      ].join("\n"),
    );
  });

  it("leaves code fences, HTML, unclosed tags, and plain prompts as written", () => {
    const literal = [
      "```xml",
      "<context>",
      "",
      "",
      "</context>",
      "```",
      "<div>",
      "<b>bold</b>",
      "<cite>Source</cite>",
      "</div>",
      '<review_comment sectionId="s" filePath="f.ts">',
      "note",
      "</review_comment>",
      "<notes>",
      "Use a < b here.",
    ].join("\n");
    expect(xmlPromptToMarkdown(literal)).toBe(literal);
    expect(xmlPromptToMarkdown("Fix the </ bug")).toBe("Fix the </ bug");
    expect(xmlPromptToMarkdown("    alpha\n\n\n    beta\n\n<task>Fix</task>\n```\ncode\n\n")).toBe(
      "    alpha\n\n\n    beta\n\n- **task**: Fix\n\n```\ncode\n\n",
    );
  });
});
