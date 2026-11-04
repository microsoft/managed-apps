#!/usr/bin/env bash
# SessionStart hook: inform the agent that the Copilot Managed Runtime plugin
# automatically attributes every `ms` CLI invocation via MS_CLI_ORIGIN.
# The PreToolUse hook (pre-tool-use.sh) enforces this transparently — this
# message just makes the behavior visible to the agent so it isn't surprised
# when the executed command differs from what it requested.

export MSG="[microsoft-managed-apps] CLI attribution is enforced automatically: every shell command that invokes 'ms' (the @microsoft/cmr-cli binary) is rewritten by a PreToolUse hook to set MS_CLI_ORIGIN=plugin/<host-agent> (e.g. plugin/claude-code, plugin/copilot-cli, or plugin/unknown). You do not need to export this variable yourself - the hook handles it on every tool call. If a user has already set MS_CLI_ORIGIN to a different value, the hook leaves their value alone."

# Read hook stdin with a bounded single-line `read -t` (payloads are
# single-line JSON) so the hook fails open quickly instead of blocking session
# startup if the host engine doesn't promptly send a newline / close stdin.
# The captured value is passed to Python via env (HOOK_INPUT) so Python never
# blocks on stdin itself.
HOOK_INPUT=""
IFS= read -r -t 2 HOOK_INPUT 2>/dev/null || true
export HOOK_INPUT

# Cross-engine contract: emit top-level additionalContext (Copilot CLI) AND
# hookSpecificOutput.additionalContext (Claude Code). Skip re-emitting on
# compaction so the guidance isn't duplicated into the compacted context.
#
# Resolve a Python interpreter with a Windows-friendly fallback chain
# (`py -3`, then `python3`, then `python`): Git Bash on Windows often lacks a
# working `python3` shim. If none is available, exit cleanly (fail open) so the
# session still starts without context injection rather than erroring.
if command -v py >/dev/null 2>&1; then
  PYTHON_BIN="py -3"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  exit 0
fi

$PYTHON_BIN -c '
import json, os, sys
try:
    raw = os.environ.get("HOOK_INPUT", "")
    data = json.loads(raw) if raw and raw.strip() else {}
except Exception:
    data = {}
if isinstance(data, dict) and data.get("source") == "compact":
    sys.exit(0)
msg = os.environ["MSG"]
print(json.dumps({
    "additionalContext": msg,
    "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": msg},
}))
'

exit 0

