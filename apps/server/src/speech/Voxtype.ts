import { VoxtypeSpeechError, type SpeechTranscriptionOptions } from "@t3tools/contracts";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ProcessRunner from "../processRunner.ts";
import { wave } from "./CloudSpeech.ts";
import { applySpeechAliases } from "./customWords.ts";
import { removeSpeechFillerWords } from "./fillerWords.ts";
import { decodeSpeechPcm, SpeechInvalidAudioError } from "./SpeechService.ts";

const COMMAND = "voxtype";
const LOG_LINE = /^\S*\d{4}-\d\d-\d\dT\d\d:\d\d/;

/**
 * `voxtype transcribe` prints progress lines, then a blank line and the transcript.
 * It reports silence by printing a notice instead of a transcript.
 */
export function parseVoxtypeTranscript(stdout: string): string {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const processing = lines.findIndex((line) => /^Processing \d+ samples/.test(line));
  const rest = (processing === -1 ? lines : lines.slice(processing + 1)).filter(
    (line) => !line.startsWith("VAD:") && !LOG_LINE.test(line),
  );
  if (rest.some((line) => line.startsWith("No speech detected"))) return "";
  return rest.join("\n").trim();
}

export class Voxtype extends Context.Service<
  Voxtype,
  {
    readonly transcribe: (
      pcm: Uint8Array,
      options: SpeechTranscriptionOptions,
    ) => Effect.Effect<string, VoxtypeSpeechError | SpeechInvalidAudioError>;
  }
>()("t3/speech/Voxtype") {}

export const layer = Layer.effect(
  Voxtype,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const failed = () => new VoxtypeSpeechError({ reason: "failed" });
    const transcribe = Effect.fn("Voxtype.transcribe")(function* (
      pcm: Uint8Array,
      options: SpeechTranscriptionOptions,
    ) {
      const samples = yield* Effect.try({
        try: () => decodeSpeechPcm(pcm),
        catch: () =>
          new SpeechInvalidAudioError({
            byteLength: pcm.byteLength,
            message: "Invalid PCM audio.",
          }),
      });
      const installed = yield* isCommandAvailable(COMMAND).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      if (!installed) return yield* new VoxtypeSpeechError({ reason: "not-installed" });
      const stdout = yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-voxtype-" });
          const file = path.join(directory, "dictation.wav");
          yield* fileSystem.writeFile(file, new Uint8Array(wave(samples)));
          const result = yield* runner.run({
            command: COMMAND,
            args: ["--quiet", "transcribe", file],
            // Voxtype logs to stdout; keep the transcript the only thing there.
            env: { ...process.env, RUST_LOG: "off", NO_COLOR: "1" },
            timeout: "2 minutes",
          });
          if (result.code !== 0) return yield* failed();
          return result.stdout;
        }),
      ).pipe(
        Effect.catchTags({
          PlatformError: () => failed(),
          ProcessSpawnError: () => new VoxtypeSpeechError({ reason: "not-installed" }),
          ProcessStdinError: () => failed(),
          ProcessOutputLimitError: () => failed(),
          ProcessReadError: () => failed(),
          ProcessTimeoutError: () => failed(),
        }),
      );
      const text = applySpeechAliases(parseVoxtypeTranscript(stdout), options.speechCustomWords);
      return (
        options.speechRemoveFillerWords
          ? removeSpeechFillerWords(text, undefined, options.speechCorrectionWord)
          : text
      ).trim();
    });
    return Voxtype.of({ transcribe });
  }),
);

export const isVoxtypeAvailable = isCommandAvailable(COMMAND);
