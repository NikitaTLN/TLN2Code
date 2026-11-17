import { describe, expect, it } from "vite-plus/test";

import { xmlToMarkdown } from "./xmlMarkdown.ts";

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
