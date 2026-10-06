$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "manifest.json"
$releaseDir = Join-Path $projectRoot "release"

Push-Location $projectRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Build extension gagal."
    }

    $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
    $zipPath = Join-Path $releaseDir "claim-clarify-v$($manifest.version).zip"

    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    Get-ChildItem -LiteralPath $releaseDir -Filter "claim-clarify-v*.zip" -File | Remove-Item -Force

    Compress-Archive -Path (Join-Path $projectRoot "dist\*") -DestinationPath $zipPath -CompressionLevel Optimal
    $zip = Get-Item -LiteralPath $zipPath
    Write-Host "Paket Chrome siap: $($zip.FullName) ($($zip.Length) bytes)"
}
finally {
    Pop-Location
}
