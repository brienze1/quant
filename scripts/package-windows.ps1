# package-windows.ps1 — copy the sherpa-onnx shared libraries next to quant.exe.
#
# The sherpa-onnx Go bindings (github.com/k2-fsa/sherpa-onnx-go-windows) link
# against sherpa-onnx-c-api.dll and onnxruntime.dll that live inside the Go
# module cache; Windows resolves DLLs from the executable's directory, so the
# packaged app just needs them copied next to quant.exe.
#
# Forward-provisioning: there is no Windows CI yet. Building quant on Windows
# needs CGO_ENABLED=1 with mingw-w64 (see build/README.md).
#
# Usage: powershell -File scripts\package-windows.ps1 [-ExePath build\bin\quant.exe]
param(
    [string]$ExePath = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($ExePath -eq "") {
    $ExePath = Join-Path $root "build\bin\quant.exe"
}
if (-not (Test-Path $ExePath)) {
    Write-Error "quant.exe not found at $ExePath — run 'wails build' first"
}
$outDir = Split-Path -Parent (Resolve-Path $ExePath).Path

# Locate the pinned sherpa-onnx-go-windows module (version comes from go.mod).
Push-Location $root
try {
    $modDir = (& go list -m -f "{{.Dir}}" github.com/k2-fsa/sherpa-onnx-go-windows).Trim()
} finally {
    Pop-Location
}
if (-not $modDir -or -not (Test-Path $modDir)) {
    Write-Error "cannot locate sherpa-onnx-go-windows module dir (got '$modDir')"
}

# Pick the lib dir by target arch (module ships x86_64 and i686 gnu builds).
$arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64-pc-windows-gnu" } else { "i686-pc-windows-gnu" }
if ($env:GOARCH -eq "386") { $arch = "i686-pc-windows-gnu" }
$libDir = Join-Path $modDir "lib\$arch"
if (-not (Test-Path $libDir)) {
    Write-Error "sherpa lib dir not found: $libDir"
}

foreach ($dll in @("sherpa-onnx-c-api.dll", "onnxruntime.dll")) {
    $src = Join-Path $libDir $dll
    if (-not (Test-Path $src)) {
        Write-Error "missing $dll in $libDir"
    }
    Copy-Item -Force $src (Join-Path $outDir $dll)
    Write-Host "[package-windows] bundled $dll"
}
Write-Host "[package-windows] done — $outDir is self-contained"
