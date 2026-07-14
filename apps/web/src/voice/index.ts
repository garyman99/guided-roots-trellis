/**
 * The single seam where the app chooses its speech engines.
 *
 * ChatGuide (and anything else) imports `speechToText` / `textToSpeech` from
 * here and never touches a concrete implementation. To move off the browser
 * engines later — a cloud STT, an on-device TTS voice — write a module that
 * satisfies the contracts in ./types and swap the two assignments below. No
 * caller changes.
 */
import { browserSpeechToText, browserTextToSpeech } from "./browserSpeech.ts";
import type { SpeechToText, TextToSpeech } from "./types.ts";

export type * from "./types.ts";

export const speechToText: SpeechToText = browserSpeechToText;
export const textToSpeech: TextToSpeech = browserTextToSpeech;

/**
 * Flatten the guide's light markdown into words worth hearing: drop code
 * fences, inline-code backticks, emphasis markers, list bullets, link syntax,
 * heading hashes, and emoji/symbols that a synth would read as noise ("🌿" →
 * "herb", "✓" → "check mark"). Narration should sound like the guide talking,
 * not like it's reciting punctuation.
 */
export function narratable(text: string): string {
  return (
    text
      // fenced + inline code → keep the words, drop the ticks
      .replace(/```[\s\S]*?```/g, (b) => b.replace(/```/g, " "))
      .replace(/`([^`]+)`/g, "$1")
      // links [label](url) → label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // emphasis + heading + list markers at line starts
      .replace(/(\*\*|\*|__|_)/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/gm, "")
      // pictographic emoji, arrows/dingbats, and variation selectors
      .replace(/[\p{Extended_Pictographic}←-➿️]/gu, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
