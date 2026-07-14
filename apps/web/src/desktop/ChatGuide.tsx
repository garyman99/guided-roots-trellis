/**
 * ChatGuide — the desktop's guide is a chat companion, not a document.
 *
 * One conversational thread merges:
 *   • the bot's authored, informal welcome (lab.chat.welcome — direct
 *     address, no "you are a…" role-play framing)
 *   • the coding agent's message, as a distinct bubble to react to
 *   • measured beats: when instrumentation marks a task done, the bot
 *     acknowledges it in the thread ("saw you run the tests ✓")
 *   • the learner ↔ instructor transcript (asks + hint-ladder replies)
 *   • proactive check-ins: the deterministic intervention engine's nudges
 *     land as bot messages with quick replies — "help me" routes into the
 *     instructor with full screen context; "I've got it" just dismisses
 *   • the checkpoint: run it from the thread; results and the reflection
 *     render inline as chat cards
 *
 * Every learner message carries a screen self-report (what windows are
 * open, which file the editor shows) so the instructor can phrase next
 * steps against what they're actually looking at.
 */
import { useEffect, useRef, useState } from "react";
import { api, type RequirementResult, type ScreenReport, type SessionCredentials, type StatePayload } from "../api.ts";
import { ContextDrawer, ReflectionCard } from "../panels.tsx";
import { useDictation, useNarration } from "../voice/useVoice.ts";
import { ChatMarkdown } from "./ChatMarkdown.tsx";

interface ChatMsg {
  key: string;
  from: "bot" | "learner" | "agent" | "system";
  text: string;
  hintLevel?: number;
  /** A nudge awaiting a quick reply. */
  nudge?: boolean;
  /** Inline checkpoint result card. */
  checkpoint?: { passed: boolean; requirements: RequirementResult[] };
  /** Render animated typing dots instead of text (message still arriving). */
  typing?: boolean;
}

const FALLBACK_BOT = "Sage";

export function ChatGuide({
  creds,
  data,
  onNewData,
  getScreen,
}: {
  creds: SessionCredentials;
  data: StatePayload;
  onNewData: (d: StatePayload) => void;
  getScreen: () => ScreenReport;
}) {
  const botName = data.lab.chat?.botName ?? FALLBACK_BOT;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const seenTranscript = useRef(new Set<number>());
  const seenTasks = useRef(new Set<string>());
  const promptedTask = useRef<string | null>(null);
  const nudgeArmed = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const completed = data.state.completedCheckpoints.includes(data.checkpoint.id);

  // ── Voice: dictate into the composer, narrate the guide's replies ─────────
  const narration = useNarration();
  const dictation = useDictation(setDraft);
  // Messages already read aloud (by key), so nothing is voiced twice. Seeded
  // with the initial thread on first pass so resuming a session doesn't
  // recite its whole history — only messages that ARRIVE get spoken.
  const spokenKeys = useRef<Set<string>>(new Set());
  const narrationPrimed = useRef(false);

  const push = (m: Omit<ChatMsg, "key">) =>
    setMsgs((cur) => [...cur, { ...m, key: `${Date.now()}-${cur.length}-${Math.random().toString(36).slice(2, 7)}` }]);

  // ── Goal-first onboarding ─────────────────────────────────────────────────
  // A FRESH session opens with ONE message: the goal prompt. The scenario
  // context (welcome, agent message, first step) arrives only after the
  // learner says what they're here to do. Resumed sessions (any transcript
  // or completed task) skip straight to the full opening.
  const isFreshSession = data.transcript.length === 0 && data.tasks.every((t) => !t.done);
  const [awaitingGoal, setAwaitingGoal] = useState(
    () => isFreshSession && !!(data.lab.chat?.goalPrompt ?? true),
  );

  const scenarioOpening = (): ChatMsg[] => {
    const welcome = data.lab.chat?.welcome?.length
      ? data.lab.chat.welcome
      : [
          `Hey! I'm ${botName} — I'll hang out right here while you work. Ask me anything, anytime.`,
          `Today: ${data.lab.title}. Take it one step at a time; I'll point the way as we go.`,
        ];
    const opening: ChatMsg[] = welcome.map((text, i) => ({ key: `w${i}`, from: "bot", text }));
    if (data.lab.agentMessage) {
      opening.push({ key: "agent", from: "agent", text: data.lab.agentMessage });
      opening.push({
        key: "w-after-agent",
        from: "bot",
        text: "That's what it says, anyway. Mind double-checking its work before we take its word for it?",
      });
    }
    return opening;
  };

  useEffect(() => {
    let stale = false;
    if (awaitingGoal) {
      // Just the opening + goal question; everything else waits for them.
      // The opening is GENERATED per session (lesson scenario + learner
      // profile briefed to the guide model) — typing dots while it arrives,
      // the authored goalPrompt if the request fails.
      setMsgs([{ key: "goal-typing", from: "bot", text: "", typing: true }]);
      const authored =
        data.lab.chat?.goalPrompt ??
        `Hey! I'm ${botName} 🌿 — before we open anything: tell me in your own words, what are you here to get done today?`;
      api
        .greeting(creds)
        .then(({ message }) => {
          if (!stale) setMsgs([{ key: "goal-prompt", from: "bot", text: message.text }]);
        })
        .catch(() => {
          if (!stale) setMsgs([{ key: "goal-prompt", from: "bot", text: authored }]);
        });
    } else {
      const opening = scenarioOpening();
      const firstOpen = data.tasks.find((t) => !t.done);
      if (firstOpen) {
        promptedTask.current = firstOpen.id;
        opening.push({ key: `task-${firstOpen.id}`, from: "bot", text: firstOpen.text });
      }
      setMsgs(opening);
    }
    // Seed dedupe sets so pre-existing transcript/tasks don't replay as new.
    for (const m of data.transcript) seenTranscript.current.add(m.id);
    for (const t of data.tasks) if (t.done) seenTasks.current.add(t.id);
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds.sessionId]);

  // ── Measured beats + the conversational path, driven by the state poll ───
  // When instrumentation marks a task done, the bot acknowledges it and then
  // offers the NEXT step — the lesson path delivered as conversation, not as
  // a checklist document.
  useEffect(() => {
    const newlyDone: string[] = [];
    for (const t of data.tasks) {
      if (t.done && !seenTasks.current.has(t.id)) {
        seenTasks.current.add(t.id);
        newlyDone.push(t.id);
      }
    }
    const next = data.tasks.find((t) => !t.done);
    if (newlyDone.length > 0) {
      push({ from: "system", text: `Saw that — nicely done. ✓` });
      if (!completed) {
        // Measured progress → the guide GENERATES the beat: completed items
        // checked off, the next step handed over (typing dots meanwhile;
        // the authored task text if generation fails).
        promptedTask.current = next?.id ?? "all-done";
        const typingKey = `prog-typing-${newlyDone.join("-")}`;
        setMsgs((cur) => [...cur, { key: typingKey, from: "bot", text: "", typing: true }]);
        api
          .progress(creds, newlyDone)
          .then(({ message }) => {
            // The server recorded it in the transcript too — don't replay it.
            seenTranscript.current.add(message.id);
            setMsgs((cur) =>
              cur.map((m) => (m.key === typingKey ? { key: `prog-${message.id}`, from: "bot" as const, text: message.text } : m)),
            );
          })
          .catch(() => {
            setMsgs((cur) =>
              cur.map((m) =>
                m.key === typingKey
                  ? { key: `${typingKey}-fallback`, from: "bot" as const, text: next?.text ?? 'All steps look done — try "Check my work".' }
                  : m,
              ),
            );
          });
      }
    } else if (next && promptedTask.current === null) {
      // Resumed session, no fresh progress: restate the open step as authored.
      promptedTask.current = next.id;
      push({ from: "bot", text: next.text });
    }
    for (const m of data.transcript) {
      if (!seenTranscript.current.has(m.id)) {
        seenTranscript.current.add(m.id);
        push({ from: m.role === "instructor" ? "bot" : "learner", text: m.text, hintLevel: m.level });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, data.transcript]);

  // ── Proactive check-ins: interventions → conversational nudges ───────────
  useEffect(() => {
    const t = setInterval(async () => {
      if (!nudgeArmed.current || completed) return;
      try {
        const { intervention } = (await api.intervention(creds)) as {
          intervention: { hint: { message: string; level: number }; triggerType: string } | null;
        };
        if (intervention) {
          nudgeArmed.current = false; // one open nudge at a time
          // ONE message: just the check-in. The hint text stays parked on
          // the server and is delivered only if they accept — never a nudge
          // immediately followed by unasked-for advice.
          push({ from: "bot", text: "Want a hand with this?", nudge: true });
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, completed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  // Narrate newly arrived guide messages. Every message is marked "seen" on
  // the first pass it appears, whether or not it's voiced — so toggling
  // narration on mid-session speaks only what comes NEXT, never a backlog.
  // Typing placeholders are skipped (their key changes once real text lands).
  useEffect(() => {
    for (const m of msgs) {
      if (spokenKeys.current.has(m.key) || m.typing) continue;
      spokenKeys.current.add(m.key);
      if (!narrationPrimed.current) continue; // initial thread → seen, not spoken
      if (m.from === "bot" || m.from === "agent" || m.from === "system") {
        narration.speak(m.text); // no-op when narration is off/unsupported
      }
    }
    narrationPrimed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs]);

  const send = async (text: string, stuck: boolean) => {
    if (!text.trim() || sending) return;
    if (dictation.listening) dictation.stop(); // sending ends the dictation turn
    setSending(true);
    setDraft("");
    const isGoal = awaitingGoal;
    try {
      if (isGoal) {
        // Their goal unlocks the scenario. Thread order: their goal, the
        // scenario context, then Sage's ack carrying the first step.
        setAwaitingGoal(false);
        const firstOpen = data.tasks.find((t) => !t.done);
        if (firstOpen) promptedTask.current = firstOpen.id; // the ack delivers it
        push({ from: "learner", text: text.trim() });
        setMsgs((cur) => [...cur, ...scenarioOpening().map((m) => ({ ...m, key: `post-goal-${m.key}` }))]);
        const { message } = (await api.ask(creds, text.trim(), false, getScreen(), true)) as {
          message: { id: number; text: string; level?: number };
        };
        // We already rendered both sides locally — don't let the transcript
        // poll replay them.
        seenTranscript.current.add(message.id);
        seenTranscript.current.add(message.id - 1);
        push({ from: "bot", text: message.text }); // no hint-ladder tag on a goal ack
        onNewData(await api.state(creds));
        return;
      }
      await api.ask(creds, text.trim(), stuck, getScreen());
      onNewData(await api.state(creds));
    } finally {
      setSending(false);
    }
  };

  const answerNudge = (accepted: boolean) => {
    setMsgs((cur) => cur.map((m) => (m.nudge ? { ...m, nudge: false } : m)));
    if (!accepted) {
      push({ from: "learner", text: "I've got it, thanks!" });
      nudgeArmed.current = true;
      void api.interventionAnswer(creds, false).catch(() => {});
      return;
    }
    // Accepted: deliver the hint that was parked when the nudge fired — no
    // second model call, the help arrives instantly.
    push({ from: "learner", text: "Yes, help me out" });
    api
      .interventionAnswer(creds, true)
      .then(({ message }) => {
        if (message) {
          seenTranscript.current.add(message.id);
          push({ from: "bot", text: message.text, hintLevel: message.level });
        }
      })
      .catch(() => void send("Yes please — what should I try next?", true))
      .finally(() => {
        nudgeArmed.current = true;
      });
  };

  const runCheck = async () => {
    setChecking(true);
    push({ from: "learner", text: "Check my work?" });
    try {
      const result = await api.evaluate(creds);
      push({
        from: "bot",
        text: result.passed
          ? "Everything checks out — that's a pass! 🎉 Here's what the platform verified:"
          : "Not quite everything yet — here's where things stand:",
        checkpoint: result,
      });
      onNewData(await api.state(creds));
    } catch {
      push({ from: "bot", text: "Hmm, I couldn't run the check just now — give it another try in a moment." });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="chat-guide">
      <div className="chat-head">
        <span className="chat-head-name">🌿 {botName}</span>
        <div className="chat-head-actions">
          {narration.supported && (
            <button
              className={`voice-toggle ${narration.enabled ? "on" : "off"}`}
              onClick={() => narration.setEnabled(!narration.enabled)}
              aria-pressed={narration.enabled}
              aria-label={narration.enabled ? `Turn off ${botName}'s voice` : `Turn on ${botName}'s voice`}
              title={
                narration.enabled
                  ? `${botName} reads replies aloud — click to mute`
                  : `${botName}'s voice is off — click to have replies read aloud`
              }
            >
              <span aria-hidden="true">{narration.enabled ? (narration.speaking ? "🔊" : "🔈") : "🔇"}</span>
              <span className="voice-toggle-label">{narration.enabled ? "Voice on" : "Voice off"}</span>
            </button>
          )}
          <button className="link" onClick={() => setShowContext(true)}>
            What does {botName} see?
          </button>
        </div>
      </div>
      <div className="chat-thread" ref={scrollRef}>
        {msgs.map((m) => (
          <div key={m.key} className={`chat-row ${m.from}`}>
            {m.from !== "learner" && (
              <span className="chat-avatar" aria-hidden="true">
                {m.from === "agent" ? "🤖" : m.from === "system" ? "✓" : "🌿"}
              </span>
            )}
            <div className={`chat-bubble ${m.from}`}>
              {m.from === "agent" && <div className="chat-tag">coding agent</div>}
              {m.from === "bot" && m.hintLevel !== undefined && (
                <div className="chat-tag">
                  {botName} · hint {Math.min(m.hintLevel + 1, 5)} of 5
                </div>
              )}
              {m.typing ? (
                <p className="chat-typing" aria-label={`${botName} is typing`}>
                  <i />
                  <i />
                  <i />
                </p>
              ) : m.from === "bot" || m.from === "agent" ? (
                // Guide/agent messages may carry light markdown (bold, code,
                // the first-step checklist); learner text stays literal.
                <ChatMarkdown text={m.text} />
              ) : (
                <p>{m.text}</p>
              )}
              {m.nudge && (
                // Both chips plain: a filled button reads as already-pressed.
                <div className="chat-chips">
                  <button className="chip" onClick={() => answerNudge(true)}>
                    Yes, help me out
                  </button>
                  <button className="chip" onClick={() => answerNudge(false)}>
                    I've got it
                  </button>
                </div>
              )}
              {m.checkpoint && (
                <ul className="chat-reqs">
                  {m.checkpoint.requirements.map((r) => (
                    <li key={r.id} className={r.ok ? "ok" : ""}>
                      {r.ok ? "✓" : "○"} {r.label}
                      {!r.ok && r.detail && <div className="chat-req-detail">{r.detail}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {completed && (
          <div className="chat-reflection">
            <ReflectionCard creds={creds} />
          </div>
        )}
      </div>
      <div className="chat-composer">
        <button className="chip" onClick={() => void runCheck()} disabled={checking}>
          {checking ? "Checking…" : "Check my work"}
        </button>
        {/* In-UI confirmation (never window.confirm: a native modal blocks the
            main thread and cannot be seen or dismissed in embedded/driven
            browsers — live-sim finding, froze the whole workspace). */}
        {confirmingReset ? (
          <>
            <button
              className="chip chip-primary"
              onClick={() => {
                setConfirmingReset(false);
                void api.reset(creds).then(async () => {
                  push({ from: "system", text: "Workspace reset — everything is back to the starting state. ✓" });
                  onNewData(await api.state(creds));
                });
              }}
            >
              Yes, reset everything
            </button>
            <button className="chip" onClick={() => setConfirmingReset(false)}>
              Keep working
            </button>
          </>
        ) : (
          <button
            className="chip"
            title="Put the workspace back exactly how it started (your edits are removed)"
            onClick={() => setConfirmingReset(true)}
          >
            Reset
          </button>
        )}
        {dictation.supported && (
          <button
            className={`mic-btn ${dictation.listening ? "recording" : ""}`}
            onClick={() => {
              if (dictation.listening) {
                dictation.stop();
              } else {
                narration.cancel(); // don't talk over the learner
                dictation.start(draft);
              }
            }}
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Stop voice input" : "Speak your message"}
            title={dictation.listening ? "Listening… click to stop" : "Speak instead of typing"}
          >
            <span aria-hidden="true">{dictation.listening ? "⏺" : "🎤"}</span>
          </button>
        )}
        <textarea
          value={draft}
          placeholder={
            dictation.listening
              ? "Listening…"
              : awaitingGoal
                ? `Tell ${botName} what you're here to do…`
                : `Message ${botName}…`
          }
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft, false);
            }
          }}
        />
        <button className="chip chip-primary" onClick={() => void send(draft, false)} disabled={sending || !draft.trim()}>
          Send
        </button>
      </div>
      {showContext && <ContextDrawer creds={creds} onClose={() => setShowContext(false)} />}
    </div>
  );
}
