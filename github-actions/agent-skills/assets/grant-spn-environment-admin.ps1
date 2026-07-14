# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

<#
.SYNOPSIS
  Grant (or remove) the EnvironmentAdmin role for a Service Principal on a
  non-Dataverse (sandbox-SKU) environment via the BAP admin REST API.

.DESCRIPTION
  Non-DV environments don't expose Application Users in the Power Platform
  Admin Center, so the SPN is granted EnvironmentAdmin directly through the
  Business Application Platform (BAP) admin API. The call must be made with an
  identity that already holds EnvironmentAdmin on the target environment — a
  Service Principal cannot grant itself the role.

  If -UserToken is not supplied, the script obtains an admin token via
  `az account get-access-token`. Run `az login --tenant <TenantId>` first.

.PARAMETER Ring
  Target ring; selects the BAP base URL. One of: Prod, Test.

.PARAMETER TenantId
  Microsoft Entra tenant GUID.

.PARAMETER EnvId
  Target environment GUID.

.PARAMETER SpnObjectId
  The Service Principal's Object ID from Azure portal -> Enterprise
  applications (NOT the App registration's Object ID — they differ, and using
  the wrong one produces a 400 "Principal not found").

.PARAMETER UserToken
  Optional bearer token for an admin user who holds EnvironmentAdmin on the
  env. If omitted, obtained via the az CLI.

.PARAMETER Remove
  Remove the SPN's EnvironmentAdmin assignment instead of adding it.

.EXAMPLE
  ./grant-spn-environment-admin.ps1 -Ring Test -TenantId <t> -EnvId <e> -SpnObjectId <o>

.EXAMPLE
  ./grant-spn-environment-admin.ps1 -Ring Test -TenantId <t> -EnvId <e> -SpnObjectId <o> -Remove
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Prod', 'Test')][string]$Ring,
    [Parameter(Mandatory)][string]$TenantId,
    [Parameter(Mandatory)][string]$EnvId,
    [Parameter(Mandatory)][string]$SpnObjectId,
    [string]$UserToken,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$baseUrl = switch ($Ring) {
    'Prod' { 'https://api.bap.microsoft.com' }
    'Test' { 'https://tip2.api.bap.microsoft.com' }
}
$apiVersion = '2021-04-01'
$envScope = "$baseUrl/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/$EnvId"

if (-not $UserToken) {
    Write-Host 'Acquiring admin token via az account get-access-token...'
    $UserToken = az account get-access-token --resource 'https://service.powerapps.com/' --query accessToken -o tsv
    if (-not $UserToken) {
        throw "Could not obtain an access token. Run 'az login --tenant $TenantId' first."
    }
}

$headers = @{ Authorization = "Bearer $UserToken" }

function Get-RoleAssignments {
    Invoke-RestMethod -Method GET -Headers $headers `
        -Uri "$envScope/roleAssignments?api-version=$apiVersion"
}

Write-Host "`n== Baseline role assignments =="
$before = Get-RoleAssignments
$before.value | ForEach-Object {
    '{0}  {1}' -f $_.properties.principal.id, $_.properties.roleDefinition.name
} | Write-Host

$entry = @{
    properties = @{
        roleDefinition = @{ id = "$envScope/roleDefinitions/EnvironmentAdmin" }
        principal      = @{ id = $SpnObjectId; type = 'ServicePrincipal'; tenantId = $TenantId }
    }
}
$body = if ($Remove) {
    @{ add = @(); remove = @($entry) }
}
else {
    @{ add = @($entry); remove = @() }
}
$body = $body | ConvertTo-Json -Depth 8

$verb = if ($Remove) { 'Removing' } else { 'Granting' }
Write-Host "`n== $verb EnvironmentAdmin for SPN $SpnObjectId =="
Invoke-RestMethod -Method POST -Headers $headers -ContentType 'application/json' -Body $body `
    -Uri "$envScope/modifyRoleAssignments?api-version=$apiVersion" | Out-Null

Write-Host "`n== Verifying =="
$after = Get-RoleAssignments
$match = $after.value | Where-Object { $_.properties.principal.id -eq $SpnObjectId }
if ($Remove) {
    if (-not $match) { Write-Host 'SUCCESS: SPN no longer has an EnvironmentAdmin assignment.' }
    else { Write-Warning 'SPN still present after remove — check inputs.' }
}
else {
    if ($match) { Write-Host 'SUCCESS: SPN now has EnvironmentAdmin.' }
    else { Write-Warning 'SPN not found after grant — check SpnObjectId / EnvId / Ring.' }
}
