/**
 * React bindings over the provider-neutral speech engines.
 *
 *  useDictation — a mic that streams the learner's speech into a text field.
 *  useNarration — reads the guide's replies aloud, default-on, with a toggle
 *                 whose state persists across sessions.
 *
 * Both are thin: all the engine specifics live behind ./index, so these hooks
 * survive a provider swap untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { narratable, speechToText, textToSpeech } from "./index.ts";
import type { SpeechToTextSession } from "./types.ts";

/**
 * Dictation into a text field. `onChange` receives the full value the field
 * should show (existing text + what's been heard so far), so the caller just
 * wires it straight to its setState. Live interim words appear and get
 * overwritten as the engine settles on a final transcript.
 */
export function useDictation(onChange: (value: string) => void) {
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<SpeechToTextSession | null>(null);
  const baseRef = useRef(""); // committed text: field value at start + settled finals
  // false = stopped; ignore any (possibly trailing) result. The engine can
  // emit a final result AFTER stop() — without this guard that late result
  // re-filled the composer just after send() cleared it.
  const activeRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const stop = useCallback(() => {
    activeRef.current = false; // freeze the field first
    sessionRef.current?.abort(); // abort, not stop → no trailing final to re-fill the draft
    sessionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback((base: string) => {
    if (!speechToText.supported || sessionRef.current) return;
    baseRef.current = base.trim() ? base.replace(/\s*$/, " ") : "";
    activeRef.current = true;
    sessionRef.current = speechToText.start({
      onInterim: (t) => {
        if (activeRef.current) onChangeRef.current(baseRef.current + t);
      },
      onFinal: (t) => {
        if (!activeRef.current) return;
        baseRef.current = (baseRef.current + t).replace(/\s*$/, " ");
        onChangeRef.current(baseRef.current);
      },
      onEnd: () => {
        sessionRef.current = null;
        setListening(false);
      },
      onError: () => {
        sessionRef.current = null;
        setListening(false);
      },
    });
    setListening(true);
  }, []);

  // Never leave the mic hot if the component unmounts mid-utterance.
  useEffect(() => () => sessionRef.current?.abort(), []);

  return { supported: speechToText.supported, listening, start, stop };
}

const NARRATION_PREF_KEY = "trellis.voice.narration";

function loadNarrationPref(): boolean {
  if (!textToSpeech.supported) return false;
  try {
    const saved = localStorage.getItem(NARRATION_PREF_KEY);
    return saved === null ? true : saved === "1"; // default ON
  } catch {
    return true;
  }
}

/**
 * Spoken narration of guide messages. `enabled` defaults on (persisted), and
 * `speak()` is a safe no-op whenever narration is off or unsupported — so
 * callers can fire it unconditionally for every new message and let the hook
 * decide whether it's actually voiced.
 */
export function useNarration() {
  const [enabled, setEnabledState] = useState(loadNarrationPref);
  const [speaking, setSpeaking] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const cancel = useCallback(() => {
    textToSpeech.cancel();
    setSpeaking(false);
  }, []);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      try {
        localStorage.setItem(NARRATION_PREF_KEY, next ? "1" : "0");
      } catch {
        /* private mode / storage blocked — session-only pref is fine */
      }
      if (!next) cancel();
    },
    [cancel],
  );

  const speak = useCallback((text: string) => {
    if (!enabledRef.current || !textToSpeech.supported) return;
    const words = narratable(text);
    if (!words) return;
    textToSpeech.speak(words, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, []);

  // Stop talking if the guide unmounts.
  useEffect(() => () => textToSpeech.cancel(), []);

  return { supported: textToSpeech.supported, enabled, setEnabled, speaking, speak, cancel };
}
