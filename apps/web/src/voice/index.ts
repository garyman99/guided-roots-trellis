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
import { VoiceToolsTextToSpeech } from "./voiceToolsSpeech.ts";

export type * from "./types.ts";

export const speechToText: SpeechToText = browserSpeechToText;
export const textToSpeech: TextToSpeech =
  import.meta.env.VITE_TTS_PROVIDER === "voice-tools"
    ? new VoiceToolsTextToSpeech({
        baseUrl: import.meta.env.VITE_TTS_BASE_URL ?? "http://127.0.0.1:48720",
        voice: import.meta.env.VITE_TTS_VOICE ?? "tara",
        lmStudioTarget: import.meta.env.VITE_TTS_LM_STUDIO_TARGET === "workstation" ? "workstation" : "headless",
      })
    : browserTextToSpeech;

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
      // Fenced code blocks → don't read the syntax aloud; point to the chat.
      .replace(/```[\s\S]*?```/g, " See the code in the chat window. ")
      // inline code → keep the word (e.g. a filename), just drop the ticks
      .replace(/`([^`]+)`/g, "$1")
      // links [label](url) → label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // emphasis + heading markers at line starts
      .replace(/(\*\*|\*|__|_)/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      // Completed checklist items are struck through in the UI — don't read
      // them back aloud. Drop the whole line; keep unchecked items (the
      // current step) and the surrounding prose.
      .replace(/^[ \t]*[-*][ \t]*\[[xX]\][^\n]*\n?/gm, "")
      // remaining list/task markers on kept lines → drop the marker, keep text
      .replace(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?/gm, "")
      // pictographic emoji, arrows/dingbats, and variation selectors
      .replace(/[\p{Extended_Pictographic}←-➿️]/gu, " ")
      // several snippets in one message → say the pointer once
      .replace(/(?:See the code in the chat window\.\s*){2,}/g, "See the code in the chat window. ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
