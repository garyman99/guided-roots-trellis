/**
 * Provider-neutral speech contracts.
 *
 * The guide needs two capabilities: turn the learner's speech into text
 * (dictation) and read the guide's replies out loud (narration). We don't
 * yet know which engine backs those in production — the browser's Web Speech
 * API for now, maybe a cloud STT/TTS or an on-device model later. So nothing
 * in the UI imports a concrete engine: ChatGuide talks to these interfaces,
 * and `voice/index.ts` is the ONE seam that decides which implementation to
 * hand back. Swapping providers = writing a new file that satisfies these
 * contracts and pointing the factory at it.
 */

// ── Speech → text (dictation) ──────────────────────────────────────────────

export interface SpeechToTextHandlers {
  /** Live, still-changing transcript for the current utterance. */
  onInterim?(text: string): void;
  /** A settled chunk of transcript that won't change further. */
  onFinal(text: string): void;
  /** Recognition ended (silence timeout, stop(), or a fatal error). */
  onEnd?(): void;
  /** A recoverable/fatal recognition error, engine-specific string code. */
  onError?(code: string): void;
}

export interface SpeechToTextSession {
  /** Politely stop after the current utterance settles. */
  stop(): void;
  /** Drop everything immediately, no final result. */
  abort(): void;
}

export interface SpeechToText {
  /** Whether this engine can run in the current environment. */
  readonly supported: boolean;
  /** Begin listening. Returns a handle to stop/abort the session. */
  start(handlers: SpeechToTextHandlers, opts?: { lang?: string }): SpeechToTextSession;
}

// ── Text → speech (narration) ──────────────────────────────────────────────

export interface TextToSpeechHandlers {
  onStart?(): void;
  onEnd?(): void;
  onError?(code: string): void;
}

export interface TextToSpeech {
  readonly supported: boolean;
  /**
   * Speak `text`. Any in-flight speech is cancelled first, so calling speak()
   * again always interrupts rather than queues across calls.
   */
  speak(text: string, handlers?: TextToSpeechHandlers, opts?: { lang?: string }): void;
  /** Stop immediately and clear anything pending. */
  cancel(): void;
  /**
   * Optional reachability check: resolves true if the backing engine is
   * usable RIGHT NOW (e.g. a local service is actually running), false if it
   * can't be reached. Engines that are always available (the browser synth)
   * may omit it. Used to auto-fall-back away from a dead local service.
   */
  probe?(): Promise<boolean>;
}
