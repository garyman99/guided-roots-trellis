/**
 * Sanitization for UNTRUSTED text (terminal output, repo content, learner
 * messages) before it is stored or shown to the instructor model.
 *
 * SECURITY BOUNDARY: everything that originates inside a lab environment is
 * attacker-controlled. Sanitization limits length and strips control
 * sequences; it does NOT make the text trustworthy. The instructor prompt
 * additionally fences this text and instructs the model to treat it as data,
 * never as instructions.
 */

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Strip ANSI + control chars, normalize newlines, cap length (head + tail kept). */
export function sanitizeUntrusted(text: string, maxLength = 2000): string {
  const clean = stripAnsi(text)
    .replace(CONTROL_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    // MARKER COLLISION DEFENSE: untrusted text must never be able to spell
    // the exact fence markers the instructor prompt uses (<<<…>>>), or it
    // could structurally "close" a fence and smuggle text outside the data
    // boundary. Break any such run with visually-similar characters.
    .replace(/<<</g, "‹<<")
    .replace(/>>>/g, ">>›");
  if (clean.length <= maxLength) return clean;
  const half = Math.floor(maxLength / 2);
  return clean.slice(0, half) + `\n… [${clean.length - maxLength} chars truncated] …\n` + clean.slice(-half);
}

/** Short sanitized summary of command output for events. */
export function summarizeOutput(text: string, maxLength = 400): string {
  return sanitizeUntrusted(text, maxLength).trim();
}
