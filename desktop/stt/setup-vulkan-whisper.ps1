param(
  [string]$Version = "v1.9.1",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$InstallPrereqs,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Require-Command($Name, $InstallHint) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd -and $Name -eq "cmake" -and (Test-Path "${env:ProgramFiles}\CMake\bin\cmake.exe")) {
    $env:PATH = "${env:ProgramFiles}\CMake\bin;$env:PATH"
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  }
  if (-not $cmd) {
    throw "Missing required command '$Name'. $InstallHint"
  }
  return $cmd.Source
}

function Install-WithWinget($Id, $Name) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { throw "winget is not available. Install $Name manually." }
  Write-Host "Installing $Name with winget..." -ForegroundColor Cyan
  winget install --id $Id --silent --accept-package-agreements --accept-source-agreements
}

if ($InstallPrereqs) {
  if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Install-WithWinget "Kitware.CMake" "CMake"
  }
  if (-not (Test-Path "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe")) {
    Install-WithWinget "Microsoft.VisualStudio.2022.BuildTools" "Visual Studio 2022 Build Tools"
    Write-Host "If Visual Studio Build Tools opened an installer UI, select 'Desktop development with C++', then rerun this script." -ForegroundColor Yellow
  }
  if (-not $env:VULKAN_SDK) {
    Install-WithWinget "KhronosGroup.VulkanSDK" "Vulkan SDK"
    Write-Host "If VULKAN_SDK was just installed, open a new terminal before rerunning this script." -ForegroundColor Yellow
  }
}

Require-Command "git" "Install Git from https://git-scm.com/download/win" | Out-Null
Require-Command "cmake" "Install CMake, or rerun with -InstallPrereqs." | Out-Null

if (-not $env:VULKAN_SDK -or -not (Test-Path $env:VULKAN_SDK)) {
  $latestVulkanSdk = Get-ChildItem "C:\VulkanSDK" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($latestVulkanSdk) {
    $env:VULKAN_SDK = $latestVulkanSdk.FullName
    $env:PATH = "$($latestVulkanSdk.FullName)\Bin;$env:PATH"
  }
}

if (-not $env:VULKAN_SDK -or -not (Test-Path $env:VULKAN_SDK)) {
  throw "VULKAN_SDK is not set. Install the Vulkan SDK, then open a new terminal. You can rerun with -InstallPrereqs."
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "Visual Studio Build Tools were not found. Install 'Desktop development with C++', or rerun with -InstallPrereqs."
}

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw "Visual Studio C++ tools were not found. Open Visual Studio Installer and add 'Desktop development with C++'."
}

$workDir = Join-Path $RepoRoot ".native-build"
$srcDir = Join-Path $workDir "whisper.cpp"
$buildDir = Join-Path $workDir "whisper.cpp-build-vulkan"
$outDir = Join-Path $RepoRoot "desktop\stt\bin\vulkan"

New-Item -ItemType Directory -Force -Path $workDir, $outDir | Out-Null

if (-not (Test-Path $srcDir)) {
  Write-Host "Cloning official whisper.cpp source..." -ForegroundColor Cyan
  git clone --branch $Version --depth 1 https://github.com/ggml-org/whisper.cpp.git $srcDir
} else {
  Write-Host "Using existing source at $srcDir" -ForegroundColor Cyan
}

if (-not $SkipBuild) {
  Write-Host "Configuring whisper.cpp Vulkan build..." -ForegroundColor Cyan
  cmake -S $srcDir -B $buildDir -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release

  Write-Host "Building whisper.cpp Vulkan binaries..." -ForegroundColor Cyan
  cmake --build $buildDir --config Release --parallel
}

$candidates = @(
  (Join-Path $buildDir "bin\Release"),
  (Join-Path $buildDir "bin"),
  (Join-Path $buildDir "examples\cli\Release"),
  (Join-Path $buildDir "Release")
) | Where-Object { Test-Path $_ }

$exe = $null
foreach ($dir in $candidates) {
  $exe = Get-ChildItem -Path $dir -Filter "whisper-cli.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { break }
}
if (-not $exe) { throw "Could not find whisper-cli.exe in build output: $buildDir" }

Write-Host "Copying Vulkan runtime files to $outDir" -ForegroundColor Cyan
Copy-Item $exe.FullName $outDir -Force
foreach ($dir in $candidates) {
  Get-ChildItem -Path $dir -Filter "*.dll" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName $outDir -Force
  }
}

if (-not (Test-Path (Join-Path $outDir "ggml-vulkan.dll"))) {
  Write-Host "Warning: ggml-vulkan.dll was not found in copied outputs. Check the build output for Vulkan DLL names." -ForegroundColor Yellow
}

Write-Host "Done. Vulkan whisper.cpp files are in: $outDir" -ForegroundColor Green
Write-Host "Next validation example:" -ForegroundColor Green
Write-Host "node desktop/stt/validate-vulkan.js --binary desktop/stt/bin/vulkan/whisper-cli.exe --model desktop/stt/models/ggml-base.en.bin --sample desktop/stt/samples/clean.wav"
