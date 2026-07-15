import assert from "node:assert/strict";
import test from "node:test";

import { VoiceToolsTextToSpeech } from "../src/voice/voiceToolsSpeech.ts";

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  played = false;

  async play(): Promise<void> {
    this.played = true;
  }

  pause(): void {
    this.paused = true;
  }
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail("condition was not reached");
}

test("Voice Tools TTS sends the configured Orpheus request and plays its WAV", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  let audio: FakeAudio | undefined;
  const revoked: string[] = [];
  const events: string[] = [];

  const tts = new VoiceToolsTextToSpeech(
    {
      baseUrl: "http://127.0.0.1:48720/",
      voice: "leah",
      lmStudioTarget: "headless",
    },
    {
      fetch: async (url, init) => {
        request = { url, init };
        return new Response(new Blob(["RIFF-test"], { type: "audio/wav" }), { status: 200 });
      },
      createAudio: () => (audio = new FakeAudio()),
      createObjectUrl: () => "blob:voice-tools-test",
      revokeObjectUrl: (url) => revoked.push(url),
    },
  );

  tts.speak("A useful explanation.", {
    onStart: () => events.push("start"),
    onEnd: () => events.push("end"),
    onError: (code) => events.push(code),
  });
  await waitFor(() => audio?.played === true);

  assert.equal(request?.url, "http://127.0.0.1:48720/v1/audio/speech");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    model: "orpheus-3b",
    input: "A useful explanation.",
    voice: "leah",
    response_format: "wav",
    lm_studio_target: "headless",
  });
  assert.equal(audio?.played, true);
  assert.deepEqual(events, ["start"]);

  audio?.onended?.();
  assert.deepEqual(events, ["start", "end"]);
  assert.deepEqual(revoked, ["blob:voice-tools-test"]);
});

test("Voice Tools TTS cancellation aborts generation without reporting an error", async () => {
  let signal: AbortSignal | undefined;
  let error: string | undefined;
  const tts = new VoiceToolsTextToSpeech(
    { baseUrl: "http://127.0.0.1:48720", voice: "tara", lmStudioTarget: "headless" },
    {
      fetch: (_url, init) => {
        signal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      },
      createAudio: () => new FakeAudio(),
      createObjectUrl: () => "blob:unused",
      revokeObjectUrl: () => {},
    },
  );

  tts.speak("Cancel this take.", { onError: (code) => (error = code) });
  tts.cancel();
  await nextTurn();

  assert.equal(signal?.aborted, true);
  assert.equal(error, undefined);
});
