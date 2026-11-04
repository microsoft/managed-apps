#!/usr/bin/env bash
# PreToolUse hook: for any shell command that invokes the `ms` CLI (the
# @microsoft/cmr-cli binary), default MS_CLI_ORIGIN to `plugin`.
# Only the native Copilot entry point passes --github-copilot to report
# MS_PLUGIN_REPORT_AGENT=github-copilot. Shared hooks remove inherited reports.
#
# Behavior:
#   - If the command does not invoke `ms`, allow unchanged.
#   - Preserve inline MS_CLI_ORIGIN assignments. A native agent report
#     remains independent of the origin override.
#   - Otherwise, rewrite the command via hookSpecificOutput.updatedInput
#     (Claude) and modifiedArgs (Copilot). The
#     rewrite defaults MS_CLI_ORIGIN only when it is truly unset
#     (`${MS_CLI_ORIGIN-...}` for bash, `Test-Path Env:MS_CLI_ORIGIN` for
#     PowerShell), so ANY pre-existing value in the parent environment wins at
#     exec time — including an intentionally-empty value — even if the hook
#     process itself does not see that value.
#
# The hook never blocks; any failure falls through to the unchanged "allow"
# decision (telemetry attribution must never block a developer's workflow).

ALLOW_UNCHANGED='{"permissionDecision":"allow","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'

INPUT_JSON=""
# Bounded single-line read (payloads are single-line JSON). A bounded read
# fails open quickly instead of stalling if the engine doesn't close stdin
# promptly (unlike `cat`, which blocks on EOF).
IFS= read -r -t 2 INPUT_JSON 2>/dev/null || true
if [ -z "$INPUT_JSON" ]; then
  printf '%s\n' "$ALLOW_UNCHANGED"
  exit 0
fi

# Resolve a Python interpreter with a Windows-friendly fallback chain
# (`py -3`, then `python3`, then `python`): Git Bash on Windows often lacks a
# working `python3` shim. If none is available, fail open (allow unchanged).
if command -v py >/dev/null 2>&1; then
  PYTHON_BIN="py -3"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  printf '%s\n' "$ALLOW_UNCHANGED"
  exit 0
fi

# Single-pass python: parse, rewrite, emit. Uses stdin for the JSON
# (no argv size limit) and emits exactly one JSON object on stdout. Any
# uncaught exception falls through to the bash-level fallback below.
PYTHON_SCRIPT=$(cat <<'PY'
import json, sys, re

ALLOW_UNCHANGED = json.dumps({
    "permissionDecision": "allow",
    "hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"},
})
ORIGIN_VALUE = "plugin"
github_copilot = sys.argv[1:] == ["--github-copilot"]

def emit_allow():
    print(ALLOW_UNCHANGED)
    sys.exit(0)

try:
    data = json.load(sys.stdin)
except Exception:
    emit_allow()
if not isinstance(data, dict):
    emit_allow()

tool_name = data.get("tool_name") or data.get("toolName") or ""
if not isinstance(tool_name, str):
    tool_name = ""

tool_input = data.get("tool_input") or data.get("input") or data.get("toolInput") or data.get("toolArgs") or {}
if not isinstance(tool_input, dict):
    emit_allow()

command = tool_input.get("command", "")
if not isinstance(command, str) or not command.strip():
    emit_allow()

# Detect `ms` as a whole-token invocation: at the start of the command
# (allowing leading whitespace and any run of `NAME=value` env-prefix
# assignments, e.g. `FOO=bar ms app dev`) or immediately after a real chain
# separator (`;`, `&`, `|`, `(`, `)`, or a newline), followed by either
# end-of-line or whitespace + a non-whitespace argument. A plain space is NOT
# treated as a command boundary, so `echo ms foo` (where `ms` is only an
# argument) is left alone. This intentionally does NOT enumerate subcommands,
# so future top-level verbs are still attributed without code changes, while
# `npm`, `terms`, `parameters`, etc. are excluded by the token-boundary check.
# Wrapper-prefixed forms (`sudo ms`, `timeout 5 ms`, `xargs ms`) are
# intentionally NOT attributed: the plugin's skills never generate them, and
# matching arbitrary preceding tokens would risk false positives.
ms_pattern = re.compile(
    r"(?:^|[;&|()\n\r])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*ms(?:\s+\S|\s*$)"
)
if not ms_pattern.search(command):
    emit_allow()

# Preserve explicit origin assignments. The boundary
# mirrors ms_pattern (start-of-command or a real chain separator, plus any
# leading env-prefix assignments) so inline assignments — including ones that
# follow other env prefixes like `FOO=bar MS_CLI_ORIGIN=mine ms ...` — are
# recognized too.
inline_pattern = re.compile(
    r"(?:^|[;&|()\n\r])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:export\s+MS_CLI_ORIGIN=|set\s+MS_CLI_ORIGIN=|MS_CLI_ORIGIN=|\$env:MS_CLI_ORIGIN\s*=)"
)
inline_origin = bool(inline_pattern.search(command))

is_powershell = tool_name.lower() in ("powershell", "pwsh")
prefix = ""
if is_powershell:
    # PowerShell: assign only when the env var does not exist, so a user-set
    # $env:MS_CLI_ORIGIN wins at exec time — including an empty value, which
    # `Test-Path Env:` correctly treats as "set" (unlike `-not $env:...`).
    if not inline_origin:
        prefix = (
            "if (-not (Test-Path Env:MS_CLI_ORIGIN)) { $env:MS_CLI_ORIGIN = '"
            + ORIGIN_VALUE
            + "' }; "
        )
    if github_copilot:
        prefix += "$env:MS_PLUGIN_REPORT_AGENT = 'github-copilot'; "
    else:
        prefix += "$env:MS_PLUGIN_REPORT_AGENT = $null; "
else:
    # Bash: ${VAR-default} (no colon) expands to the default ONLY when VAR is
    # unset, so any pre-existing user value — including an intentionally-empty
    # one — is preserved at exec time. The `&&` chain ensures the export runs
    # before the user command, and `export` makes the value visible to chained
    # segments (`cd app && ms app deploy`) and to the spawned `ms` process.
    if not inline_origin:
        prefix = 'export MS_CLI_ORIGIN="${MS_CLI_ORIGIN-' + ORIGIN_VALUE + '}" && '
    if github_copilot:
        prefix += "export MS_PLUGIN_REPORT_AGENT='github-copilot' && "
    else:
        prefix += "unset -v MS_PLUGIN_REPORT_AGENT && "

updated = dict(tool_input)
updated["command"] = prefix + command
reason = "Set plugin attribution for @microsoft/cmr-cli"
# Keep legacy fields, native Copilot modifiedArgs, and the Claude wrapper.
print(json.dumps({
    "permissionDecision": "allow",
    "permissionDecisionReason": reason,
    "updatedInput": updated,
    "modifiedArgs": updated,
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": reason,
        "updatedInput": updated,
    }
}))
PY
)

OUTPUT=$(printf '%s' "$INPUT_JSON" | $PYTHON_BIN -c "$PYTHON_SCRIPT" "$@" 2>/dev/null)
if [ -z "$OUTPUT" ]; then
  printf '%s\n' "$ALLOW_UNCHANGED"
else
  printf '%s\n' "$OUTPUT"
fi
exit 0
