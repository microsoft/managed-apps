# SessionStart hook (PowerShell): inform the agent that the Microsoft Managed
# Apps plugin automatically attributes every `ms` CLI invocation via
# MS_CLI_ORIGIN. The PreToolUse hook enforces this transparently.
$ErrorActionPreference = 'SilentlyContinue'

$msg = "[microsoft-managed-apps] CLI attribution is enforced automatically: every shell command that invokes 'ms' (the @microsoft/cmr-cli binary) is rewritten by a PreToolUse hook to set MS_CLI_ORIGIN=plugin/<host-agent> (e.g. plugin/claude-code, plugin/copilot-cli, or plugin/unknown). You do not need to export this variable yourself - the hook handles it on every tool call. If a user has already set MS_CLI_ORIGIN to a different value, the hook leaves their value alone."

# Skip re-emitting on compaction so the guidance isn't duplicated.
try {
    $raw = [Console]::In.ReadLine()
    $data = if ($raw) { $raw | ConvertFrom-Json } else { $null }
} catch {
    $data = $null
}
if ($data -and $data.source -eq 'compact') { exit 0 }

# Cross-engine contract: emit top-level additionalContext (Copilot CLI) AND
# hookSpecificOutput.additionalContext (Claude Code).
@{
    additionalContext  = $msg
    hookSpecificOutput = @{
        hookEventName     = 'SessionStart'
        additionalContext = $msg
    }
} | ConvertTo-Json -Compress -Depth 5

exit 0
