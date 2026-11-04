#!/usr/bin/env bash
# SessionStart hook: inform the agent that the Copilot Managed Runtime plugin
# automatically attributes every `ms` CLI invocation via MS_CLI_ORIGIN.
# The PreToolUse hook (pre-tool-use.sh) enforces this transparently — this
# message just makes the behavior visible to the agent so it isn't surprised
# when the executed command differs from what it requested.

export MSG="[microsoft-managed-apps] The PreToolUse hook defaults MS_CLI_ORIGIN to plugin for commands that invoke the ms CLI (@microsoft/cmr-cli). It preserves existing origin values, including empty values and inline assignments. The native Copilot hook also sets MS_PLUGIN_REPORT_AGENT=github-copilot from its fixed entry point. Shared hooks remove inherited agent reports so the CLI can detect the agent. The plugin does not detect agents from environment markers. Do not add attribution variables yourself when hooks are active."

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
