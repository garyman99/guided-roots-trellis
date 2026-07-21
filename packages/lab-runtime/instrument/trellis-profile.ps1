# Trellis instrumented shell — PowerShell 7 (pwsh) on the Linux lab bench.
#
# The pwsh counterpart of trellis-bashrc.sh: emits the SAME tab-separated
# records to $env:TRELLIS_EVENTS_FILE —
#   cmd \t <base64(command)> \t <exitCode> \t <startMs> \t <endMs>
# Command text is base64-encoded so quotes/newlines can never corrupt framing
# (or smuggle fake event lines).
#
# Approach: the `prompt` function fires after every interactive command; it
# reads the newest history entry (which carries Start/EndExecutionTime) and
# pairs it with the success state read FIRST thing in the prompt (before any
# cmdlet in here can clobber $?).
#
# KNOWN LIMITATION (parity with the bash instrumentation):
#   • compound lines (a; b) are one record — what the learner typed.

if (-not $env:TERM) { $env:TERM = "xterm-256color" }
# Pagers are disabled: in an embedded learning terminal, `git diff` should
# print, not open an interactive pager (which also swallows typed input).
$env:PAGER = "cat"; $env:GIT_PAGER = "cat"; $env:GIT_TERMINAL_PROMPT = "0"

# Force UTF-8 both ways so box-drawing/accented output can't decode to U+FFFD.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# PSReadLine renders with syntax-highlighting + Predictive IntelliSense, which
# repaint aggressively over this embedded pty. Keep PSReadLine (it drives line
# editing + history) but strip the features that garble: no prediction, no
# ANSI syntax colors. This plus the server-side cursor-report handling keeps
# the render simple and stable.
try {
  Set-PSReadLineOption -PredictionSource None -BellStyle None
  Set-PSReadLineOption -Colors @{
    Command = "`e[0m"; Parameter = "`e[0m"; Operator = "`e[0m"; Variable = "`e[0m"
    String = "`e[0m"; Number = "`e[0m"; Member = "`e[0m"; Type = "`e[0m"
    Comment = "`e[0m"; Keyword = "`e[0m"; ContinuationPrompt = "`e[0m"; Default = "`e[0m"
  }
} catch { <# PSReadLine unavailable — basic host still works #> }

# Size the pty to the browser terminal (defaults match the web UI's initial fit).
try { & /usr/bin/stty cols ($env:TRELLIS_COLS ?? '120') rows ($env:TRELLIS_ROWS ?? '30') 2>$null } catch { }

$script:TrellisLastHistoryId = 0

function prompt {
  # $? MUST be read before anything else runs in this function.
  $ok = $?
  $native = $global:LASTEXITCODE
  $ec = if ($ok) { 0 } elseif ($native -is [int] -and $native -ne 0) { $native } else { 1 }
  $h = Get-History -Count 1
  # The startup dot-source (`pwsh -NoExit -Command '. …trellis-profile.ps1'`)
  # lands in history too — never record it as a learner command.
  if ($h -and $h.Id -ne $script:TrellisLastHistoryId -and $env:TRELLIS_EVENTS_FILE -and $h.CommandLine -notmatch 'trellis-profile\.ps1') {
    $script:TrellisLastHistoryId = $h.Id
    try {
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($h.CommandLine))
      $startMs = [DateTimeOffset]::new($h.StartExecutionTime.ToUniversalTime(), [TimeSpan]::Zero).ToUnixTimeMilliseconds()
      $endMs = [DateTimeOffset]::new($h.EndExecutionTime.ToUniversalTime(), [TimeSpan]::Zero).ToUnixTimeMilliseconds()
      [IO.File]::AppendAllText($env:TRELLIS_EVENTS_FILE, "cmd`t$b64`t$ec`t$startMs`t$endMs`n")
    } catch { <# never let instrumentation break the learner's prompt #> }
  }
  # The AUTHENTIC PowerShell 7 prompt — the whole point of the pwsh bench.
  "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}
