# Trellis instrumented shell.
#
# Emits deterministic command records to $TRELLIS_EVENTS_FILE as
# tab-separated lines:  <kind> \t <base64(command)> \t <exitCode> \t <startMs> \t <endMs>
# Command text is base64-encoded so quotes/newlines in commands can never
# corrupt framing (and can never smuggle fake event lines).
#
# Approach: a DEBUG trap stamps the start time of each command line; the
# PROMPT_COMMAND hook reads the full line from history, pairs it with the
# stamped start time, and emits one record with the real exit code.
#
# KNOWN LIMITATION: compound lines (a && b) are recorded as one line, which
# is what the learner typed and what an instructor should see.

export PS1='\[\e[32m\]lab\[\e[0m\]:\[\e[34m\]\w\[\e[0m\]\$ '
export TERM="${TERM:-xterm-256color}"
# Pagers are disabled: in an embedded learning terminal, `git diff` should
# print, not open an interactive pager (which also swallows typed input).
export PAGER=cat GIT_PAGER=cat GIT_TERMINAL_PROMPT=0
shopt -s histappend
# ignorespace: platform control commands (terminal resize) are sent with a
# leading space so they never appear as learner commands. Side effect —
# documented limitation: a learner typing ' cmd' escapes command capture.
HISTCONTROL=ignorespace
# Size the pty to the browser terminal (defaults match the web UI's initial fit).
stty cols "${TRELLIS_COLS:-120}" rows "${TRELLIS_ROWS:-30}" 2>/dev/null || true

__trellis_now_ms() { date +%s%3N; }

__trellis_pending_start=""
__trellis_last_histcmd=""
__trellis_in_hook=0

__trellis_debug_trap() {
  [ "$__trellis_in_hook" = 1 ] && return 0
  [ -n "$COMP_LINE" ] && return 0
  if [ -z "$__trellis_pending_start" ]; then
    __trellis_pending_start="$(__trellis_now_ms)"
  fi
  return 0
}

__trellis_prompt_hook() {
  local ec=$?
  __trellis_in_hook=1
  if [ -n "$__trellis_pending_start" ] && [ -n "$TRELLIS_EVENTS_FILE" ]; then
    local histline num cmd
    histline="$(HISTTIMEFORMAT= builtin history 1)"
    num="${histline%%[!0-9 ]*}"; num="${num// /}"
    if [ -n "$num" ] && [ "$num" != "$__trellis_last_histcmd" ]; then
      __trellis_last_histcmd="$num"
      cmd="$(printf '%s' "$histline" | sed 's/^ *[0-9]\{1,\}[* ] *//' | base64 -w0)"
      printf 'cmd\t%s\t%s\t%s\t%s\n' "$cmd" "$ec" "$__trellis_pending_start" "$(__trellis_now_ms)" >> "$TRELLIS_EVENTS_FILE"
    fi
  fi
  __trellis_pending_start=""
  __trellis_in_hook=0
}

trap '__trellis_debug_trap' DEBUG
PROMPT_COMMAND=__trellis_prompt_hook

cd "${TRELLIS_WORKSPACE:-$PWD}" 2>/dev/null || true
echo "Welcome to the lab. This is a real shell — look around."
