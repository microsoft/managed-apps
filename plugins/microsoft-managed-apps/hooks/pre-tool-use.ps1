# PreToolUse hook (PowerShell): for any shell command that invokes the `ms`
# CLI (the @microsoft/managed-apps-cli binary), default MS_CLI_ORIGIN to
# `plugin/<host-agent>` (e.g. plugin/claude-code, plugin/copilot-cli, or
# plugin/unknown) for that invocation. Every CLI command run by this plugin
# or any of its skills is thereby attributed for telemetry.
#
# Behavior:
#   - If the command does not invoke `ms`, allow unchanged.
#   - If the command already sets MS_CLI_ORIGIN inline, allow unchanged.
#   - Otherwise, rewrite the command via hookSpecificOutput.updatedInput
#     (Claude) and modifiedArgs (Copilot). The
#     rewrite defaults MS_CLI_ORIGIN only when it is truly unset
#     (`${MS_CLI_ORIGIN-...}` for bash tools, `Test-Path Env:MS_CLI_ORIGIN`
#     for PowerShell tools), so ANY pre-existing value in the parent
#     environment wins at exec time — including an intentionally-empty value —
#     even if the hook process itself does not see that value.
#
# The hook never blocks; any failure falls through to the unchanged "allow"
# decision (telemetry attribution must never block a developer's workflow).

$ErrorActionPreference = 'Stop'

$PLUGIN_ID = 'plugin'

# Detect the host agent so telemetry can split plugin attribution by which
# CLI ran the command. Falls back to "unknown" rather than dropping the
# suffix so the format (plugin/host) is stable for downstream parsers.
if ($env:CLAUDECODE -eq '1' -or $env:CLAUDE_CODE_ENTRYPOINT) {
    $HOST_AGENT = 'claude-code'
} elseif ($env:COPILOT_CLI -eq '1' -or $env:COPILOT_AGENT_SESSION_ID) {
    $HOST_AGENT = 'copilot-cli'
} else {
    $HOST_AGENT = 'unknown'
}
$ORIGIN_VALUE     = "$PLUGIN_ID/$HOST_AGENT"
$ALLOW_UNCHANGED  = '{"permissionDecision":"allow","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'

function Write-AllowUnchanged {
    Write-Output $ALLOW_UNCHANGED
    exit 0
}

function Write-AllowWithRewrite {
    param(
        [string]$NewCommand,
        [hashtable]$OriginalInput
    )
    $updated = @{}
    if ($OriginalInput) {
        foreach ($k in $OriginalInput.Keys) { $updated[$k] = $OriginalInput[$k] }
    }
    $updated['command'] = $NewCommand
    $payload = @{
        permissionDecision       = 'allow'
        permissionDecisionReason = 'Auto-set MS_CLI_ORIGIN for @microsoft/managed-apps-cli attribution'
        updatedInput             = $updated
        modifiedArgs             = $updated
        hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = 'allow'
            permissionDecisionReason = 'Auto-set MS_CLI_ORIGIN for @microsoft/managed-apps-cli attribution'
            updatedInput             = $updated
        }
    }
    $payload | ConvertTo-Json -Compress -Depth 10
    exit 0
}

try {
    # Read JSON from stdin. Payloads are single-line JSON, so a bounded
    # ReadLine() fails open quickly instead of stalling if the engine doesn't
    # close stdin promptly (unlike ReadToEnd(), which blocks until EOF).
    $raw = [Console]::In.ReadLine()
    if (-not $raw) { Write-AllowUnchanged }

    $data = $raw | ConvertFrom-Json
    if (-not $data) { Write-AllowUnchanged }

    # Locate tool name (tolerant of multiple field-naming styles)
    $toolName = ''
    foreach ($prop in @('tool_name', 'toolName')) {
        if ($data.PSObject.Properties[$prop]) { $toolName = [string]$data.$prop; break }
    }

    # Locate tool input
    $toolInput = $null
    foreach ($prop in @('tool_input', 'input', 'toolInput', 'toolArgs')) {
        if ($data.PSObject.Properties[$prop]) { $toolInput = $data.$prop; break }
    }
    if (-not $toolInput) { Write-AllowUnchanged }

    $command = ''
    if ($toolInput.PSObject.Properties['command']) { $command = [string]$toolInput.command }
    if ([string]::IsNullOrWhiteSpace($command)) { Write-AllowUnchanged }

    # Convert tool_input PSCustomObject to a hashtable so we can splat it back.
    $inputHash = @{}
    foreach ($p in $toolInput.PSObject.Properties) { $inputHash[$p.Name] = $p.Value }

    # Detect `ms` as a whole-token invocation: at the start of the command
    # (allowing leading whitespace and any run of `NAME=value` env-prefix
    # assignments, e.g. `FOO=bar ms app dev`) or immediately after a real
    # chain separator (`;`, `&`, `|`, `(`, `)`, or a newline), followed by
    # either end-of-line or whitespace + a non-whitespace argument. A plain
    # space is NOT a command boundary, so `echo ms foo` (where `ms` is only an
    # argument) is left alone. Intentionally does NOT enumerate subcommands,
    # so future top-level verbs are still attributed without code changes;
    # `npm`, `terms`, `parameters`, etc. are excluded by the token boundary.
    # Wrapper-prefixed forms (`sudo ms`, `timeout 5 ms`, `xargs ms`) are
    # intentionally NOT attributed: the plugin's skills never generate them,
    # and matching arbitrary preceding tokens would risk false positives.
    $msPattern = '(^|[;&|()\n\r])\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*ms(\s+\S|\s*$)'
    if ($command -notmatch $msPattern) { Write-AllowUnchanged }

    # Already explicitly set in the command itself? Don't touch. The boundary
    # mirrors $msPattern (start-of-command or a real chain separator, plus any
    # leading env-prefix assignments) so inline assignments — including ones
    # that follow other env prefixes like `FOO=bar MS_CLI_ORIGIN=mine ms ...`
    # — are recognized too.
    $inlinePattern = '(^|[;&|()\n\r])\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(export\s+MS_CLI_ORIGIN=|set\s+MS_CLI_ORIGIN=|MS_CLI_ORIGIN=|\$env:MS_CLI_ORIGIN\s*=)'
    if ($command -match $inlinePattern) { Write-AllowUnchanged }

    # Native Copilot payloads identify the actual shell. Legacy payloads
    # retain the existing platform-based fallback.
    $isPowerShellTool = $true
    if ($data.PSObject.Properties['toolName']) {
        $isPowerShellTool = $toolName.ToLowerInvariant() -in @('powershell', 'pwsh')
    }

    if ($isPowerShellTool) {
        # Assign only when the env var does not exist, so a user-set
        # $env:MS_CLI_ORIGIN wins at exec time — including an empty value,
        # which `Test-Path Env:` treats as "set" (unlike `-not $env:...`).
        $newCommand = "if (-not (Test-Path Env:MS_CLI_ORIGIN)) { `$env:MS_CLI_ORIGIN = '$ORIGIN_VALUE' }; $command"
    } else {
        # `${VAR-default}` (no colon) expands to the default ONLY when VAR is
        # unset, so any pre-existing user value — including an intentionally-
        # empty one — is preserved at exec time. The leading `$` of the bash
        # expansion is backtick-escaped so PowerShell does not interpolate it;
        # only `$ORIGIN_VALUE` is expanded here. The `&&` chain runs the export
        # before the user command, and `export` makes the value visible to
        # chained segments and to the spawned `ms` process.
        $newCommand = "export MS_CLI_ORIGIN=`"`${MS_CLI_ORIGIN-$ORIGIN_VALUE}`" && $command"
    }

    Write-AllowWithRewrite -NewCommand $newCommand -OriginalInput $inputHash
} catch {
    # Any unexpected failure: fall through to allow-unchanged so we never
    # block the user's command.
    Write-AllowUnchanged
}
