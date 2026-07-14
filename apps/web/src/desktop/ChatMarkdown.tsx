/**
 * ChatMarkdown — tiny renderer for the guide's chat bubbles.
 *
 * Deliberately small and dependency-free, and it builds React nodes (never
 * innerHTML), so model output can't smuggle markup into the page. Supports
 * exactly the subset the instructor prompt allows: paragraphs, **bold**,
 * *italic*, `code`, bullet lists, and task-list items (`- [ ]` / `- [x]`).
 * Unchecked task items render as the highlighted "your next step" card.
 */
import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={`${keyBase}c${i++}`}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={`${keyBase}b${i++}`}>{tok.slice(2, -2)}</strong>);
    else out.push(<em key={`${keyBase}e${i++}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface ListItem {
  /** null = plain bullet; true/false = task item checked state. */
  checked: boolean | null;
  text: string;
}

/**
 * Task items follow the guide's hard format `**Title** — description`;
 * when the leading bold title is present it renders as its own heading line.
 */
function TaskBody({ text, keyBase }: { text: string; keyBase: string }) {
  const titled = /^\*\*(.+?)\*\*\s*[—:–-]?\s*(.*)$/.exec(text);
  if (!titled) return <span className="md-task-body">{inline(text, keyBase)}</span>;
  return (
    <span className="md-task-body">
      <span className="md-task-title">{titled[1]}</span>
      {titled[2] && <span className="md-task-desc">{inline(titled[2], keyBase)}</span>}
    </span>
  );
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: ListItem[] = [];
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={`k${key}`}>{inline(para.join(" "), `p${key}`)}</p>);
    key++;
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const items = list;
    blocks.push(
      <ul key={`k${key}`} className="md-list">
        {items.map((it, i) =>
          it.checked === null ? (
            <li key={i}>{inline(it.text, `l${key}-${i}`)}</li>
          ) : (
            <li key={i} className={`md-task ${it.checked ? "done" : "open"}`}>
              <span className="md-task-box" aria-hidden="true">
                {it.checked ? "✓" : ""}
              </span>
              <TaskBody text={it.text} keyBase={`l${key}-${i}`} />
            </li>
          ),
        )}
      </ul>,
    );
    key++;
    list = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const task = /^[-*] \[([ xX])\] (.*)$/.exec(line);
    const bullet = /^[-*] (.+)$/.exec(line);
    if (task) {
      flushPara();
      list.push({ checked: task[1] !== " ", text: task[2] });
    } else if (bullet) {
      flushPara();
      list.push({ checked: null, text: bullet[1] });
    } else if (line === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="chat-md">{blocks}</div>;
}
