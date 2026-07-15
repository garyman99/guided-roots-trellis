/**
 * The single seam where the app chooses its speech engines.
 *
 * Narration has TWO backends, both satisfying the TextToSpeech contract, and
 * the learner flips between them at runtime (a UI toggle drives useNarration):
 *   • "browser"     — the Web Speech API; dependency-free, always available.
 *   • "voice-tools" — a local Orpheus service (OpenAI /v1/audio/speech-shaped);
 *                     nicer voice, needs the service running.
 * Dictation (speech→text) stays browser-only. VITE_TTS_PROVIDER only picks the
 * DEFAULT engine; the toggle overrides it live.
 */
import { browserSpeechToText, browserTextToSpeech } from "./browserSpeech.ts";
import { VoiceToolsTextToSpeech } from "./voiceToolsSpeech.ts";
import type { SpeechToText, TextToSpeech } from "./types.ts";

export type * from "./types.ts";

export type TtsEngine = "browser" | "voice-tools";

export const speechToText: SpeechToText = browserSpeechToText;

// The local-service narrator, configured from env. `supported` here only means
// the browser can play audio — whether the Orpheus service is up is discovered
// at speak() time (a failed take surfaces onError, and the UI can fall back).
const voiceToolsTextToSpeech = new VoiceToolsTextToSpeech({
  baseUrl: import.meta.env.VITE_TTS_BASE_URL ?? "http://127.0.0.1:48720",
  voice: import.meta.env.VITE_TTS_VOICE ?? "tara",
  lmStudioTarget: import.meta.env.VITE_TTS_LM_STUDIO_TARGET === "workstation" ? "workstation" : "headless",
});

/** The concrete narrator for a chosen engine. */
export function textToSpeechFor(engine: TtsEngine): TextToSpeech {
  return engine === "voice-tools" ? voiceToolsTextToSpeech : browserTextToSpeech;
}

export interface TtsEngineInfo {
  id: TtsEngine;
  label: string;
  supported: boolean;
}

/** Narration engines to offer in the toggle (browser first, the reliable one). */
export function ttsEngines(): TtsEngineInfo[] {
  return [
    { id: "browser", label: "Browser voice", supported: browserTextToSpeech.supported },
    { id: "voice-tools", label: "Local voice (Orpheus)", supported: voiceToolsTextToSpeech.supported },
  ];
}

/** Build-time default engine (VITE_TTS_PROVIDER); the runtime toggle overrides it. */
export const defaultTtsEngine: TtsEngine =
  import.meta.env.VITE_TTS_PROVIDER === "voice-tools" ? "voice-tools" : "browser";

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
