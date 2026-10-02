param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginSource = Join-Path $projectRoot "plugins\liquid-glass-pet"
$mcpSource = Join-Path $projectRoot "bridge\pet-mcp.mjs"
$profilePath = $env:USERPROFILE
$pluginTarget = Join-Path $profilePath "plugins\liquid-glass-pet"
$marketplaceDirectory = Join-Path $profilePath ".agents\plugins"
$marketplacePath = Join-Path $marketplaceDirectory "marketplace.json"
$mcpDirectory = Join-Path $env:LOCALAPPDATA "LiquidGlassPet\integration"
$mcpTarget = Join-Path $mcpDirectory "pet-mcp.mjs"

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  throw "Codex CLI was not found. Install or enable Codex CLI, then run this script again."
}
if (-not (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found on PATH. Install Node.js 20.19+ and run this script again."
}
$nodePath = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
if (-not (Test-Path -LiteralPath (Join-Path $pluginSource ".codex-plugin\plugin.json"))) {
  throw "The bundled Codex plugin was not found at $pluginSource."
}
if (-not (Test-Path -LiteralPath $mcpSource)) {
  throw "The bundled notification server was not found at $mcpSource."
}

$codexMcpText = (& codex mcp list --json 2>$null | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect existing Codex MCP servers. No MCP registration was changed."
}
try {
  $codexMcpEntries = ConvertFrom-Json -InputObject $codexMcpText
} catch {
  throw "Codex returned invalid MCP JSON. No MCP registration was changed."
}
$existingMcp = @($codexMcpEntries | Where-Object { $_.name -eq "liquid-glass-pet" })
$mcpAlreadyRegistered = $false
if ($existingMcp.Count -gt 0) {
  $registeredType = [string]$existingMcp[0].transport.type
  $registeredCommand = [string]$existingMcp[0].transport.command
  $registeredArguments = @($existingMcp[0].transport.args)
  $mcpAlreadyRegistered = (
    $registeredType -ceq "stdio" -and
    $registeredCommand -ceq $nodePath -and
    $registeredArguments.Count -eq 1 -and
    [string]$registeredArguments[0] -ceq $mcpTarget
  )
  if (-not $mcpAlreadyRegistered) {
    throw "A different MCP server named liquid-glass-pet already exists. It was left unchanged; inspect it with 'codex mcp list --json'."
  }
}

if (Test-Path -LiteralPath $marketplacePath) {
  try {
    $catalog = Get-Content -LiteralPath $marketplacePath -Raw | ConvertFrom-Json
  } catch {
    throw "The personal plugin catalog is not valid JSON. It was left unchanged: $marketplacePath"
  }
  if ($catalog.name -ne "personal") {
    throw "The existing catalog at $marketplacePath is named '$($catalog.name)', not 'personal'. It was left unchanged."
  }
  $existingEntry = @($catalog.plugins | Where-Object { $_.name -eq "liquid-glass-pet" })
  if ($existingEntry.Count -gt 0 -and $existingEntry[0].source.path -ne "./plugins/liquid-glass-pet") {
    throw "The personal catalog already has a liquid-glass-pet entry with another source path. It was left unchanged."
  }
} else {
  $catalog = [ordered]@{
    name = "personal"
    interface = [ordered]@{ displayName = "Personal" }
    plugins = @()
  }
  $existingEntry = @()
}

if ((Test-Path -LiteralPath $pluginTarget) -and $existingEntry.Count -eq 0) {
  throw "The destination already exists and is not listed in the personal catalog. Move it aside before installing: $pluginTarget"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginTarget), $marketplaceDirectory, $mcpDirectory | Out-Null
if (-not (Test-Path -LiteralPath $pluginTarget)) {
  Copy-Item -LiteralPath $pluginSource -Destination $pluginTarget -Recurse
}
Copy-Item -LiteralPath $mcpSource -Destination $mcpTarget -Force

if ($existingEntry.Count -eq 0) {
  $catalog.plugins = @($catalog.plugins) + @(
    [ordered]@{
      name = "liquid-glass-pet"
      source = [ordered]@{
        source = "local"
        path = "./plugins/liquid-glass-pet"
      }
      policy = [ordered]@{
        installation = "AVAILABLE"
        authentication = "ON_INSTALL"
      }
      category = "Productivity"
    }
  )
}

$catalogJson = $catalog | ConvertTo-Json -Depth 12
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($marketplacePath, $catalogJson, $utf8WithoutBom)

if (-not $mcpAlreadyRegistered) {
  & codex mcp add liquid-glass-pet -- $nodePath $mcpTarget
  if ($LASTEXITCODE -ne 0) {
    throw "Codex MCP registration failed. The local plugin files remain in place; inspect 'codex mcp list' before retrying."
  }
} else {
  Write-Host "The matching Deskfolk MCP server is already registered."
}

& codex plugin add liquid-glass-pet --marketplace personal
if ($LASTEXITCODE -ne 0) {
  throw "Codex plugin installation failed. The personal catalog and MCP registration remain in place; restart Codex and install Deskfolk from the personal plugin source."
}

Write-Host ""
Write-Host "Deskfolk is registered with Codex."
Write-Host "Restart the Codex desktop app, then review and trust the plugin hooks before they run."
Write-Host "The app must be running for desktop notifications to appear."
