import { describe, expect, it } from "vite-plus/test";
import { parseVoxtypeTranscript } from "./Voxtype.ts";

const header = 'Loading audio file: "a.wav"\nAudio format: 16000 Hz, 1 channel(s), Int\n';

describe("parseVoxtypeTranscript", () => {
  it.each([
    [
      "the transcript after progress",
      `${header}Processing 32000 samples (2.00s)...\n\nHello there.\n`,
      "Hello there.",
    ],
    ["an empty transcript", `${header}Processing 32000 samples (2.00s)...\n\n\n`, ""],
    [
      "the VAD summary and log lines",
      `${header}Processing 32000 samples (2.00s)...\nVAD: 1.20s speech (60.0% of audio)\n2026-11-17T14:16:36.015878Z  WARN noise\n\nShip it.\n`,
      "Ship it.",
    ],
    [
      "silence",
      `${header}Processing 32000 samples (2.00s)...\nVAD: 0.00s speech (0.0% of audio)\nNo speech detected, skipping transcription.\n`,
      "",
    ],
  ])("reads %s", (_name, stdout, expected) => {
    expect(parseVoxtypeTranscript(stdout)).toBe(expected);
  });
});
