# Publish v0.9.6 installer + .sig + latest.json to GitHub plhys/VeryAgent
# Prerequisites: signed NSIS artifacts already in src-tauri/target/release/bundle/nsis/
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Nsis = Join-Path $Root "src-tauri\target\release\bundle\nsis"
$Staging = Join-Path $Root ".release-upload-0.9.6"
$Repo = "plhys/VeryAgent"
$Tag = "v0.9.6"
$Version = "0.9.6"

New-Item -ItemType Directory -Force -Path $Staging | Out-Null
$exe = Get-ChildItem $Nsis -Filter "*0.9.6*x64-setup.exe" | Where-Object { $_.Name -notlike "*.sig" } | Select-Object -First 1
if (-not $exe) { throw "Installer not found under $Nsis" }
$sig = Get-Item ($exe.FullName + ".sig") -ErrorAction SilentlyContinue
if (-not $sig) { throw "Missing signature: $($exe.FullName).sig" }

Copy-Item $exe.FullName (Join-Path $Staging $exe.Name) -Force
Copy-Item $sig.FullName (Join-Path $Staging $sig.Name) -Force

$sigText = (Get-Content $sig.FullName -Raw).Trim()
$notes = Get-Content (Join-Path $Root ".release-notes-0.9.6.md") -Raw -Encoding UTF8
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$url = "https://github.com/$Repo/releases/download/$Tag/$($exe.Name)"
$latestObj = [ordered]@{
  version  = $Version
  notes    = $notes.Trim()
  pub_date = $pubDate
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $sigText
      url       = $url
    }
  }
}
$latest = $latestObj | ConvertTo-Json -Depth 6
$latestPath = Join-Path $Staging "latest.json"
# UTF-8 without BOM — BOM breaks some updaters / JSON parsers
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($latestPath, $latest, $utf8NoBom)

Write-Host "Staging:"
Get-ChildItem $Staging | Format-Table Name, Length

# Create or update release (gh prints "release not found" to stderr; don't treat as terminating)
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$existing = gh release view $Tag -R $Repo 2>$null
$viewOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEap
if (-not $viewOk) {
  gh release create $Tag -R $Repo --title $Tag --notes-file (Join-Path $Root ".release-notes-0.9.6.md") --latest `
    (Join-Path $Staging $exe.Name) (Join-Path $Staging $sig.Name) $latestPath
  if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
} else {
  gh release upload $Tag -R $Repo --clobber `
    (Join-Path $Staging $exe.Name) (Join-Path $Staging $sig.Name) $latestPath
  if ($LASTEXITCODE -ne 0) { throw "gh release upload failed" }
  gh release edit $Tag -R $Repo --notes-file (Join-Path $Root ".release-notes-0.9.6.md") --latest
}
Write-Host "GitHub release done: https://github.com/$Repo/releases/tag/$Tag"
