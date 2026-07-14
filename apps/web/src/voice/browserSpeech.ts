/**
 * Browser Web Speech API backing for the voice contracts.
 *
 * Dictation  → SpeechRecognition (webkit-prefixed in Chrome/Edge/Safari).
 * Narration  → speechSynthesis / SpeechSynthesisUtterance (broadly supported,
 *              no extra dependency — this is the answer to "is browser-only
 *              TTS possible?": yes).
 *
 * Neither is in every browser (Firefox ships no SpeechRecognition), hence the
 * `supported` flags — the UI hides the affordance when the engine is absent
 * rather than offering a dead button.
 */
import type {
  SpeechToText,
  SpeechToTextHandlers,
  SpeechToTextSession,
  TextToSpeech,
  TextToSpeechHandlers,
} from "./types.ts";

// ── Minimal Web Speech typings ─────────────────────────────────────────────
// The DOM lib's SpeechRecognition types aren't guaranteed across TS versions
// and the constructor is vendor-prefixed, so we declare just what we touch.
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}
interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => BrowserRecognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Dictation ──────────────────────────────────────────────────────────────

class BrowserSpeechToText implements SpeechToText {
  readonly supported = recognitionCtor() !== null;

  start(handlers: SpeechToTextHandlers, opts?: { lang?: string }): SpeechToTextSession {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      // Caller should have checked `supported`; degrade to a no-op session.
      handlers.onEnd?.();
      return { stop() {}, abort() {} };
    }
    const rec = new Ctor();
    rec.lang = opts?.lang ?? navigator.language ?? "en-US";
    rec.continuous = true; // keep listening across pauses until stop()
    rec.interimResults = true; // stream partial words as they're heard

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) handlers.onFinal(text);
        else interim += text;
      }
      if (interim) handlers.onInterim?.(interim);
    };
    rec.onerror = (e) => {
      // "no-speech"/"aborted" are routine stops, not failures worth surfacing.
      if (e.error !== "no-speech" && e.error !== "aborted") handlers.onError?.(e.error);
    };
    rec.onend = () => handlers.onEnd?.();

    try {
      rec.start();
    } catch {
      // start() throws if called while already running; treat as a clean end.
      handlers.onEnd?.();
    }
    return {
      stop: () => rec.stop(),
      abort: () => rec.abort(),
    };
  }
}

// ── Narration ──────────────────────────────────────────────────────────────

/** Split into speakable chunks — some engines truncate long single utterances. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

class BrowserTextToSpeech implements TextToSpeech {
  readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;

  speak(text: string, handlers?: TextToSpeechHandlers, opts?: { lang?: string }): void {
    if (!this.supported) return;
    const synth = window.speechSynthesis;
    synth.cancel(); // interrupt whatever was speaking — speak() never queues across calls

    const chunks = sentences(text);
    if (chunks.length === 0) return;

    let started = false;
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (opts?.lang) u.lang = opts.lang;
      if (i === 0) {
        u.onstart = () => {
          if (!started) {
            started = true;
            handlers?.onStart?.();
          }
        };
      }
      if (i === chunks.length - 1) {
        u.onend = () => handlers?.onEnd?.();
      }
      u.onerror = () => handlers?.onError?.("synthesis-error");
      synth.speak(u);
    });
  }

  cancel(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}

export const browserSpeechToText: SpeechToText = new BrowserSpeechToText();
export const browserTextToSpeech: TextToSpeech = new BrowserTextToSpeech();
