$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ManifestPath = Join-Path $RepoRoot "src-tauri\runtime-assets.json"
$DownloadDir = Join-Path $RepoRoot "target-downloads\runtime-assets"
$ExtractDir = Join-Path $DownloadDir "extract"

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest nao encontrado: $ManifestPath"
}

New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null

$Manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
$Assets = @($Manifest.assets)

function Get-AssetById {
  param([Parameter(Mandatory = $true)][string]$Id)
  $Asset = $Assets | Where-Object { $_.id -eq $Id } | Select-Object -First 1
  if (-not $Asset) {
    throw "Asset '$Id' nao existe no manifest."
  }
  return $Asset
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (Test-Path $Destination) {
    Write-Host "Usando download existente: $Destination"
    return
  }

  Write-Host "Baixando: $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Destination
}

function Copy-FromZip {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $ZipName = [IO.Path]::GetFileNameWithoutExtension($ZipPath)
  $UnzipDir = Join-Path $ExtractDir $ZipName
  if (Test-Path $UnzipDir) {
    Remove-Item -LiteralPath $UnzipDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $UnzipDir | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $UnzipDir -Force

  $Source = Get-ChildItem -Path $UnzipDir -Recurse -File -Filter $FileName | Select-Object -First 1
  if (-not $Source) {
    throw "Arquivo '$FileName' nao encontrado dentro de $ZipPath"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source.FullName -Destination $Destination -Force
}

function Copy-DirectDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

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

function Verify-Asset {
  param([Parameter(Mandatory = $true)]$Asset)

  $Path = Join-Path (Join-Path $RepoRoot "src-tauri") $Asset.packagePath
  if (-not (Test-Path $Path)) {
    throw "Asset ausente: $($Asset.packagePath)"
  }

  $ActualHash = Get-Sha256 -Path $Path
  $ExpectedHash = [string]$Asset.sha256
  if ($ActualHash -ne $ExpectedHash.ToLowerInvariant()) {
    throw "Checksum invalido para $($Asset.packagePath). Esperado $ExpectedHash, obtido $ActualHash"
  }

  Write-Host "OK: $($Asset.packagePath)"
}

$FfmpegAsset = Get-AssetById "ffmpeg"
$YtDlpAsset = Get-AssetById "yt-dlp"
$DenoAsset = Get-AssetById "deno"

$FfmpegZip = Join-Path $DownloadDir "ffmpeg-release-essentials.zip"
$DenoZip = Join-Path $DownloadDir "deno-x86_64-pc-windows-msvc.zip"
$YtDlpFile = Join-Path $DownloadDir "yt-dlp.exe"

Download-File -Url $FfmpegAsset.source -Destination $FfmpegZip
Download-File -Url $YtDlpAsset.source -Destination $YtDlpFile
Download-File -Url $DenoAsset.source -Destination $DenoZip

$UniqueAssets = $Assets | Sort-Object packagePath -Unique
foreach ($Asset in $UniqueAssets) {
  $Destination = Join-Path (Join-Path $RepoRoot "src-tauri") $Asset.packagePath
  $LeafName = Split-Path -Leaf $Destination

  if ($Asset.source -eq $FfmpegAsset.source) {
    Copy-FromZip -ZipPath $FfmpegZip -FileName $LeafName -Destination $Destination
  } elseif ($Asset.source -eq $DenoAsset.source) {
    Copy-FromZip -ZipPath $DenoZip -FileName $LeafName -Destination $Destination
  } elseif ($Asset.source -eq $YtDlpAsset.source) {
    Copy-DirectDownload -Source $YtDlpFile -Destination $Destination
  } else {
    throw "Fonte de asset nao suportada pelo script: $($Asset.source)"
  }
}

foreach ($Asset in $UniqueAssets) {
  Verify-Asset -Asset $Asset
}

Write-Host "Assets runtime prontos para build local e release."
