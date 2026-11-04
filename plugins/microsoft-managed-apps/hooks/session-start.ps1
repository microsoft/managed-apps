# SessionStart hook (PowerShell): inform the agent that the Copilot Managed Runtime
# plugin automatically attributes every `ms` CLI invocation via
# MS_CLI_ORIGIN. The PreToolUse hook enforces this transparently.
$ErrorActionPreference = 'SilentlyContinue'

$msg = "[microsoft-managed-apps] The PreToolUse hook defaults MS_CLI_ORIGIN to plugin for commands that invoke the ms CLI (@microsoft/cmr-cli). It preserves existing origin values, including empty values and inline assignments. The native Copilot hook also sets MS_PLUGIN_REPORT_AGENT=github-copilot from its fixed entry point. Shared hooks remove inherited agent reports so the CLI can detect the agent. The plugin does not detect agents from environment markers. Do not add attribution variables yourself when hooks are active."

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
