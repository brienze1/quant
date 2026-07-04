# Build Directory

The build directory is used to house all the build files and assets for your application. 

## Voice engine native libraries (sherpa-onnx)

Quant embeds the sherpa-onnx speech engine (Whisper STT + Kokoro TTS) via CGo.
The Go bindings link against **shared** native libraries that ship inside the
Go module cache (`github.com/k2-fsa/sherpa-onnx-go-{macos,windows,linux}`), so
a plain build produces a binary that only works while the module cache exists.
Per platform:

### macOS

`wails build` runs the `darwin/*` postBuildHook in `wails.json`, which calls
`scripts/fixup-macos-dylibs.sh`. The script copies
`libsherpa-onnx-c-api.dylib` + `libonnxruntime.*.dylib` from the module cache
into `quant.app/Contents/Frameworks`, replaces the module-cache `LC_RPATH`
with `@executable_path/../Frameworks`, and re-codesigns the bundle ad-hoc.
This makes the packaged .app self-contained (works for Homebrew installs,
where the build cache is deleted). The hook is a no-op for `wails dev` builds,
which keep resolving from the module cache. The script is idempotent and never
hardcodes the module version (it uses `go list -m`).

### Windows (forward-provisioning — no Windows CI yet)

CGo requires a C toolchain: install **mingw-w64** (e.g. via MSYS2 or
`choco install mingw`) and build with `CGO_ENABLED=1`. After `wails build`,
run `powershell -File scripts\package-windows.ps1` to copy
`sherpa-onnx-c-api.dll` + `onnxruntime.dll` from the
`sherpa-onnx-go-windows` module cache next to `quant.exe` (Windows resolves
DLLs from the exe's directory, so no rpath surgery is needed).

### Linux (documentation only)

The equivalent fix is: copy `libsherpa-onnx-c-api.so` + `libonnxruntime.so`
from the `sherpa-onnx-go-linux` module cache (`lib/x86_64-unknown-linux-gnu/`
or `lib/aarch64-unknown-linux-gnu/`) next to the binary (or into a `lib/`
sibling dir), then set the rpath with
`patchelf --set-rpath '$ORIGIN' quant` (no codesigning involved).


The structure is:

* bin - Output directory
* darwin - macOS specific files
* windows - Windows specific files

## Mac

The `darwin` directory holds files specific to Mac builds.
These may be customised and used as part of the build. To return these files to the default state, simply delete them
and
build with `wails build`.

The directory contains the following files:

- `Info.plist` - the main plist file used for Mac builds. It is used when building using `wails build`.
- `Info.dev.plist` - same as the main plist file but used when building using `wails dev`.

## Windows

The `windows` directory contains the manifest and rc files used when building with `wails build`.
These may be customised for your application. To return these files to the default state, simply delete them and
build with `wails build`.

- `icon.ico` - The icon used for the application. This is used when building using `wails build`. If you wish to
  use a different icon, simply replace this file with your own. If it is missing, a new `icon.ico` file
  will be created using the `appicon.png` file in the build directory.
- `installer/*` - The files used to create the Windows installer. These are used when building using `wails build`.
- `info.json` - Application details used for Windows builds. The data here will be used by the Windows installer,
  as well as the application itself (right click the exe -> properties -> details)
- `wails.exe.manifest` - The main application manifest file.