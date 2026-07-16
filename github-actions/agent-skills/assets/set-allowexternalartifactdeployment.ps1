<#
  Helper functions to read and write the Power Platform environment setting
  MicrosoftApps_AllowExternalArtifactDeployment, which must be `true` before a
  BYOB / escape-hatch (repoType: none) managed app can be deployed.

  Requires PowerShell 7 and Environment Admin on the target environment.

  Authentication:
    The token must be a *delegated user token* captured from a live Power
    Platform Admin Center (PPAC) browser session. Azure CLI cannot mint the
    required scope (fails with AADSTS65002).

    Capture it from admin.powerplatform.com with F12 -> Network: trigger any
    request to `api.*.powerplatform.com` and copy the `authorization` header
    value (the part AFTER "Bearer "). For a DV env you can open
    Settings -> Features; for a non-DV env (no Settings page) just open the
    environment or let the Environments list load.

  API endpoint:
    Production   https://api.powerplatform.com/
    (Microsoft-internal non-production rings follow the same pattern,
     https://api.<ring>.powerplatform.com/ — external customers use Production.)

  Usage:
    . ./set-allowexternalartifactdeployment.ps1
    $token = Read-Host -AsSecureString "Paste the PPAC bearer token (Value only)"
    Get-MicrosoftAppsAllowExternalArtifactDeployment -Token $token -Env '<env id>' -ApiEndpoint 'https://api.test.powerplatform.com/'
    Set-MicrosoftAppsAllowExternalArtifactDeployment -Token $token -Env '<env id>' -ApiEndpoint 'https://api.test.powerplatform.com/' -AllowExternalArtifactDeployment $true
#>

<#
.SYNOPSIS
  Retrieves the MicrosoftApps_AllowExternalArtifactDeployment setting for a Power Platform environment.
#>
function Get-MicrosoftAppsAllowExternalArtifactDeployment {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Env,

    [Parameter(Mandatory = $true)]
    [securestring]$Token,

    [uri]$ApiEndpoint = 'https://api.powerplatform.com/'
  )
  $ErrorActionPreference = 'Stop'

  $escapedEnv = [System.Uri]::EscapeDataString($Env)
  $root = $ApiEndpoint.ToString().TrimEnd('/')
  $uri = "$root/environmentmanagement/environments/$escapedEnv/settings?api-version=2022-03-01-preview&`$select=MicrosoftApps_AllowExternalArtifactDeployment"

  $resp = Invoke-RestMethod -Uri $uri -Method Get -Authentication Bearer -Token $Token
  $data = $resp.objectResult[0]

  @{
    AllowExternalArtifactDeployment = $data.MicrosoftApps_AllowExternalArtifactDeployment
  }
}

<#
.SYNOPSIS
  Updates the MicrosoftApps_AllowExternalArtifactDeployment setting for a Power Platform environment.

.PARAMETER AllowExternalArtifactDeployment
  $true to allow external artifact deployment, $false to disallow, or $null to
  clear the setting and revert to the default (not explicitly configured).
#>
function Set-MicrosoftAppsAllowExternalArtifactDeployment {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Env,

    [Parameter(Mandatory = $true)]
    [securestring]$Token,

    [uri]$ApiEndpoint = 'https://api.powerplatform.com/',

    [AllowNull()]
    [System.Nullable[bool]]$AllowExternalArtifactDeployment
  )
  $ErrorActionPreference = 'Stop'

  $payload = @{}
  if ($PSBoundParameters.ContainsKey('AllowExternalArtifactDeployment')) {
    $payload['MicrosoftApps_AllowExternalArtifactDeployment'] = $AllowExternalArtifactDeployment
  }

  $escapedEnv = [System.Uri]::EscapeDataString($Env)
  $root = $ApiEndpoint.ToString().TrimEnd('/')
  $uri = "$root/environmentmanagement/environments/$escapedEnv/settings?api-version=2022-03-01-preview"
  $body = $payload | ConvertTo-Json -Depth 10

  if ($PSCmdlet.ShouldProcess($Env, "Set MicrosoftApps_AllowExternalArtifactDeployment = $AllowExternalArtifactDeployment")) {
    Invoke-RestMethod -Uri $uri -Method Patch -Authentication Bearer -Token $Token -Body $body -ContentType 'application/json' | Out-Null
  }
}
