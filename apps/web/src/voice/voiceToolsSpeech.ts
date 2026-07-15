/**
 * Voice Tools adapter for guide narration.
 *
 * The service is OpenAI speech-compatible, but also accepts the allow-listed
 * LM Studio target that should run Orpheus. Generation is asynchronous and
 * cancellable; a newer guide message always interrupts an older take.
 */
import type { TextToSpeech, TextToSpeechHandlers } from "./types.ts";

export interface VoiceToolsTextToSpeechOptions {
  baseUrl: string;
  voice: string;
  lmStudioTarget: "workstation" | "headless";
}

interface AudioHandle {
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

interface VoiceToolsDependencies {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  createAudio: (url: string) => AudioHandle;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
}

function browserDependencies(): VoiceToolsDependencies | null {
  if (
    typeof window === "undefined" ||
    typeof Audio === "undefined" ||
    typeof fetch === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }
  return {
    fetch: window.fetch.bind(window),
    createAudio: (url) => new Audio(url),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}

export class VoiceToolsTextToSpeech implements TextToSpeech {
  readonly supported: boolean;
  private readonly options: VoiceToolsTextToSpeechOptions;
  private readonly dependencies: VoiceToolsDependencies | null;
  private controller: AbortController | null = null;
  private audio: AudioHandle | null = null;
  private objectUrl: string | null = null;
  private generation = 0;

  constructor(options: VoiceToolsTextToSpeechOptions, dependencies?: VoiceToolsDependencies) {
    this.options = { ...options, baseUrl: options.baseUrl.replace(/\/+$/, "") };
    this.dependencies = dependencies ?? browserDependencies();
    this.supported = this.dependencies !== null;
  }

  speak(text: string, handlers?: TextToSpeechHandlers): void {
    this.cancel();
    if (!this.dependencies || !text.trim()) return;

    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    handlers?.onStart?.();

    void this.generateAndPlay(text.trim(), generation, controller.signal, handlers).catch((error: unknown) => {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.releaseAudio();
      this.controller = null;
      const code = error instanceof Error && error.message.startsWith("tts-http-")
        ? error.message
        : "tts-request-error";
      handlers?.onError?.(code);
    });
  }

  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.releaseAudio();
  }

  private async generateAndPlay(
    text: string,
    generation: number,
    signal: AbortSignal,
    handlers?: TextToSpeechHandlers,
  ): Promise<void> {
    const dependencies = this.dependencies;
    if (!dependencies) return;

    const response = await dependencies.fetch(`${this.options.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: "orpheus-3b",
        input: text,
        voice: this.options.voice,
        response_format: "wav",
        lm_studio_target: this.options.lmStudioTarget,
      }),
    });
    if (!response.ok) throw new Error(`tts-http-${response.status}`);

    const audioBlob = await response.blob();
    if (signal.aborted || generation !== this.generation) return;

    const objectUrl = dependencies.createObjectUrl(audioBlob);
    const audio = dependencies.createAudio(objectUrl);
    this.objectUrl = objectUrl;
    this.audio = audio;
    audio.onended = () => {
      if (generation !== this.generation) return;
      this.releaseAudio();
      this.controller = null;
      handlers?.onEnd?.();
    };
    audio.onerror = () => {
      if (generation !== this.generation) return;
      this.releaseAudio();
      this.controller = null;
      handlers?.onError?.("tts-playback-error");
    };
    await audio.play();
  }

  private releaseAudio(): void {
    this.audio?.pause();
    this.audio = null;
    if (this.objectUrl && this.dependencies) {
      this.dependencies.revokeObjectUrl(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
