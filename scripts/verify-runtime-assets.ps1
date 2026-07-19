param(
  [string]$PackageRoot = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ManifestPath = Join-Path $RepoRoot "src-tauri\runtime-assets.json"

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest nao encontrado: $ManifestPath"
}

$Manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
$Assets = @($Manifest.assets) | Sort-Object packagePath -Unique

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $HashBytes = $Sha256.ComputeHash($Stream)
      return ([System.BitConverter]::ToString($HashBytes)).Replace("-", "").ToLowerInvariant()
    } finally {
      $Sha256.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

function Join-RelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(Mandatory = $true)][string]$Relative
  )

  return Join-Path $Base ($Relative -replace "/", "\")
}

function Resolve-AssetPath {
  param([Parameter(Mandatory = $true)]$Asset)

  if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    return Join-RelativePath -Base (Join-Path $RepoRoot "src-tauri") -Relative $Asset.packagePath
  }

  $ResolvedPackageRoot = Resolve-Path $PackageRoot
  $RuntimePath = [string]$Asset.runtimePath
  $PackagePath = [string]$Asset.packagePath
  $Candidates = @(
    (Join-RelativePath -Base $ResolvedPackageRoot -Relative $RuntimePath),
    (Join-RelativePath -Base (Join-Path $ResolvedPackageRoot "resources") -Relative $RuntimePath),
    (Join-RelativePath -Base $ResolvedPackageRoot -Relative $PackagePath)
  )

  foreach ($Candidate in $Candidates) {
    if (Test-Path $Candidate -PathType Leaf) {
      return $Candidate
    }
  }

  return $Candidates[0]
}

$RequiredIds = @("ffmpeg", "ffprobe", "yt-dlp", "deno")
foreach ($Id in $RequiredIds) {
  if (-not ($Manifest.assets | Where-Object { $_.id -eq $Id } | Select-Object -First 1)) {
    throw "Asset obrigatorio ausente no manifest: $Id"
  }
}

$Failures = New-Object System.Collections.Generic.List[string]

foreach ($Asset in $Assets) {
  $Path = Resolve-AssetPath -Asset $Asset
  if (-not (Test-Path $Path -PathType Leaf)) {
    $Failures.Add("Asset ausente: $($Asset.packagePath)")
    continue
  }

  $ActualHash = Get-Sha256 -Path $Path
  $ExpectedHash = ([string]$Asset.sha256).ToLowerInvariant()
  if ($ActualHash -ne $ExpectedHash) {
    $Failures.Add("Checksum invalido para $($Asset.packagePath). Esperado $ExpectedHash, obtido $ActualHash")
  }
}

if ($Failures.Count -gt 0) {
  throw "Assets runtime invalidos:`n$($Failures -join "`n")"
}

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
  Write-Host "Assets runtime validados em src-tauri/resources."
} else {
  Write-Host "Assets runtime validados no pacote: $PackageRoot"
}
