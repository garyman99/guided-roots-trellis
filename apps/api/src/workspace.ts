/**
 * WorkspaceRuntime — simulated applications for workspace labs (no terminal,
 * no container): a seeded email client and a simulated AI helper.
 *
 * PRINCIPLES (mirroring the platform's core rule):
 *   • The platform measures; events carry CLASSIFICATIONS (authored span /
 *     pattern IDs), never learner prose. Content lives only in this
 *     in-memory runtime and dies with the session (or reset).
 *   • The AI helper is part of the LESSON CONTENT — a simulated workplace
 *     tool, deliberately imperfect, deterministic, and key-free. It is NOT
 *     the instructor. It only "knows" what the learner explicitly shares.
 *   • Consequential-looking actions are visibly simulated: submit is
 *     "send simulated reply", and nothing leaves the session.
 */
import { now, type SessionEvent } from "../../../packages/session-events/src/events.ts";

// ── Manifest types (lab.json → workspace) ─────────────────────────────────

export interface WorkspaceAppSpec {
  id: string;
  title: string;
  icon: string;
}

export interface WorkspaceEmailSpec {
  inbox: Array<{ id: string; from: string; subject: string; body: string; receivedAgoMinutes?: number }>;
  notes: Array<{ id: string; title: string; body: string }>;
  /** The artifact the learner's reply belongs to. */
  replyTo: string;
}

export interface WorkspacePolicySpec {
  /** Exact scenario strings that must not reach the AI helper or the reply. */
  restrictedSpans: Array<{ id: string; text: string; label: string; reason: string }>;
  /** Authored regexes (case-insensitive) the final reply must not match. */
  forbiddenPhrases: Array<{ id: string; pattern: string; label: string }>;
  /** Authored regexes for facts that must reach the helper and stay in the reply. */
  requiredFacts: Array<{ id: string; pattern: string; label: string }>;
  /** Substrings any of which count as acknowledging the inconvenience (approximate). */
  acknowledgementLexicon: string[];
  /** Submitted reply must be at or below this similarity to the AI draft. */
  meaningfulEditMaxSimilarity: number;
}

export interface WorkspaceSpec {
  apps: WorkspaceAppSpec[];
  email: WorkspaceEmailSpec;
  aiChat: { assistantName: string; tagline: string };
  policy: WorkspacePolicySpec;
}

// ── Text classification against the AUTHORED policy ───────────────────────

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

function restrictedIn(policy: WorkspacePolicySpec, text: string): string[] {
  const t = norm(text);
  return policy.restrictedSpans.filter((s) => t.includes(norm(s.text))).map((s) => s.id);
}

function matchingPatterns(specs: Array<{ id: string; pattern: string }>, text: string): string[] {
  const out: string[] = [];
  for (const spec of specs) {
    try {
      if (new RegExp(spec.pattern, "i").test(text)) out.push(spec.id);
    } catch {
      /* an unparseable authored pattern never matches; lab tests catch this */
    }
  }
  return out;
}

function acknowledges(policy: WorkspacePolicySpec, text: string): boolean {
  const t = norm(text);
  return policy.acknowledgementLexicon.some((phrase) => t.includes(norm(phrase)));
}

/** Normalized-Levenshtein similarity in [0,1]; capped input so it stays cheap. */
export function textSimilarity(a: string, b: string): number {
  const cap = 1500;
  const x = norm(a).slice(0, cap);
  const y = norm(b).slice(0, cap);
  if (x === y) return 1;
  if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

// ── The simulated AI helper ────────────────────────────────────────────────

/**
 * Deterministic draft composer. Imperfect BY DESIGN — the learning objective
 * is verify-and-edit, so every draft ships with teachable flaws:
 *   • it happily echoes whatever restricted content it was given,
 *   • it volunteers an unapproved promise,
 *   • it signs off with a placeholder instead of the learner's voice.
 * It only uses facts present in the shared context (echoed via the authored
 * fact patterns), never scenario knowledge the learner didn't provide.
 */
function composeDraft(policy: WorkspacePolicySpec, context: string, seq: number): string {
  const factEchoes = policy.requiredFacts.flatMap((f) => {
    try {
      const m = context.match(new RegExp(f.pattern, "i"));
      return m ? [m[0]] : [];
    } catch {
      return [];
    }
  });
  const restrictedEchoes = policy.restrictedSpans.filter((s) => norm(context).includes(norm(s.text)));

  const subject = factEchoes.length ? `about ${factEchoes[0]}` : "about your order";
  const lines = [
    `Hi there,`,
    ``,
    `Thank you for reaching out ${subject}. I'm sorry for the delay and for any inconvenience this has caused.`,
  ];
  if (/tomorrow|tracking|deliver/i.test(context)) {
    lines.push(
      ``,
      `The tracking page shows it is out for delivery and expected tomorrow.`,
      `I can promise it will arrive tomorrow — you have my personal guarantee it won't happen again.`,
    );
  } else {
    lines.push(``, `Rest assured — I can promise this will not happen again.`);
  }
  for (const s of restrictedEchoes) {
    lines.push(``, `For reference, I have noted ${s.text} on this case.`);
  }
  lines.push(``, `Please let me know if there is anything else I can help with.`, ``, `Best regards,`, `[Your Name]`);
  if (seq > 1) lines.splice(2, 0, `(Here is another take.)`);
  return lines.join("\n");
}

const NO_CONTEXT_REPLY =
  "I don't have any details about the situation yet — I can only work with what you share here. " +
  "Paste the parts of the customer's message you think I need (just those), tell me the tone you want, and I'll draft a reply.";

// ── Runtime ────────────────────────────────────────────────────────────────

export interface ChatEntry {
  id: number;
  role: "learner" | "assistant";
  text: string;
  /** Chars of context attached to this learner message (0 = none). */
  contextChars?: number;
  /** Set on assistant entries that contain a usable draft. */
  draftId?: string;
}

const CAPS = { prompt: 4_000, context: 8_000, draft: 8_000, thread: 60 };

export class WorkspaceRuntime {
  private readonly spec: WorkspaceSpec;
  private readonly emit: (e: SessionEvent) => void;

  private readEmails = new Set<string>();
  private thread: ChatEntry[] = [];
  private drafts = new Map<string, string>();
  private reply = { text: "", revision: 0, baselineDraftId: null as string | null };
  private submittedFlag = false;
  private seq = 0;

  constructor(spec: WorkspaceSpec, emit: (e: SessionEvent) => void) {
    this.spec = spec;
    this.emit = emit;
  }

  openApp(appId: string): void {
    if (!this.spec.apps.some((a) => a.id === appId)) throw new Error("unknown app");
    this.emit({ type: "workspace.app.opened", appId, timestamp: now() });
  }

  openArtifact(appId: string, artifactId: string): void {
    const known =
      this.spec.email.inbox.some((m) => m.id === artifactId) || this.spec.email.notes.some((n) => n.id === artifactId);
    if (!known) throw new Error("unknown artifact");
    this.readEmails.add(artifactId);
    this.emit({ type: "workspace.artifact.opened", appId, artifactId, timestamp: now() });
  }

  chatSend(promptRaw: string, contextRaw: string): ChatEntry {
    const prompt = promptRaw.slice(0, CAPS.prompt);
    const context = contextRaw.slice(0, CAPS.context);
    if (!prompt.trim() && !context.trim()) throw new Error("empty message");
    const policy = this.spec.policy;

    if (context.trim()) {
      this.emit({
        type: "aichat.context.shared",
        chars: context.length,
        restrictedSpans: restrictedIn(policy, context),
        requiredFacts: matchingPatterns(policy.requiredFacts, context),
        timestamp: now(),
      });
    }
    this.emit({
      type: "aichat.prompt.submitted",
      chars: prompt.length,
      restrictedSpans: restrictedIn(policy, prompt),
      timestamp: now(),
    });
    this.thread.push({ id: ++this.seq, role: "learner", text: prompt, contextChars: context.trim().length });

    let assistant: ChatEntry;
    if (!context.trim() && !this.hasEverSharedContext()) {
      assistant = { id: ++this.seq, role: "assistant", text: NO_CONTEXT_REPLY };
    } else {
      // Context accumulates within the conversation, like a real chat tool:
      // the helper works from everything shared so far (latest wins for policy).
      const allContext = this.thread
        .filter((e) => e.role === "learner")
        .map((e) => e.text)
        .join("\n") + "\n" + context;
      const draftId = `draft-${this.seq + 1}`;
      const text = composeDraft(policy, context.trim() ? context : allContext, this.drafts.size + 1);
      this.drafts.set(draftId, text);
      this.emit({
        type: "aichat.response.generated",
        draftId,
        echoedRestricted: restrictedIn(policy, text),
        timestamp: now(),
      });
      assistant = { id: ++this.seq, role: "assistant", text, draftId };
    }
    this.thread.push(assistant);
    if (this.thread.length > CAPS.thread) this.thread = this.thread.slice(-CAPS.thread);
    return assistant;
  }

  private hasEverSharedContext(): boolean {
    return this.thread.some((e) => e.role === "learner" && (e.contextChars ?? 0) > 0);
  }

  insertDraft(draftId: string): void {
    const text = this.drafts.get(draftId);
    if (text === undefined) throw new Error("unknown draft");
    this.reply = { text, revision: 0, baselineDraftId: draftId };
    this.emit({ type: "workspace.draft.inserted", artifactId: this.spec.email.replyTo, draftId, timestamp: now() });
  }

  updateDraft(textRaw: string): void {
    const text = textRaw.slice(0, CAPS.draft);
    if (text === this.reply.text) return; // no-op saves are not edits
    this.reply.text = text;
    this.reply.revision += 1;
    const baseline = this.reply.baselineDraftId ? this.drafts.get(this.reply.baselineDraftId) ?? null : null;
    this.emit({
      type: "workspace.draft.updated",
      artifactId: this.spec.email.replyTo,
      revision: this.reply.revision,
      similarityToGenerated: baseline === null ? null : round3(textSimilarity(text, baseline)),
      chars: text.length,
      timestamp: now(),
    });
  }

  submitReply(): { simulated: true } {
    if (!this.reply.text.trim()) throw new Error("the reply is empty");
    const policy = this.spec.policy;
    const text = this.reply.text;
    const baseline = this.reply.baselineDraftId ? this.drafts.get(this.reply.baselineDraftId) ?? null : null;
    this.emit({
      type: "workspace.artifact.submitted",
      artifactId: this.spec.email.replyTo,
      revision: this.reply.revision,
      similarityToGenerated: baseline === null ? null : round3(textSimilarity(text, baseline)),
      restrictedSpans: restrictedIn(policy, text),
      forbiddenPhrases: matchingPatterns(policy.forbiddenPhrases, text),
      requiredFactsMissing: policy.requiredFacts
        .filter((f) => !matchingPatterns([f], text).length)
        .map((f) => f.id),
      acknowledgesInconvenience: acknowledges(policy, text),
      simulated: true,
      timestamp: now(),
    });
    this.submittedFlag = true;
    return { simulated: true };
  }

  reset(): void {
    this.readEmails.clear();
    this.thread = [];
    this.drafts.clear();
    this.reply = { text: "", revision: 0, baselineDraftId: null };
    this.submittedFlag = false;
  }

  /** Everything the learner-facing apps render. */
  view() {
    return {
      apps: this.spec.apps,
      email: {
        inbox: this.spec.email.inbox.map((m) => ({ ...m, read: this.readEmails.has(m.id) })),
        notes: this.spec.email.notes,
        replyTo: this.spec.email.replyTo,
      },
      aiChat: { ...this.spec.aiChat, thread: this.thread },
      reply: {
        text: this.reply.text,
        revision: this.reply.revision,
        hasAiBaseline: this.reply.baselineDraftId !== null,
        submitted: this.submittedFlag,
      },
    };
  }
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
