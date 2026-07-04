#!/usr/bin/env bash
# fixup-macos-dylibs.sh — make the packaged quant.app self-contained.
#
# The sherpa-onnx Go bindings (github.com/k2-fsa/sherpa-onnx-go-macos) link
# against SHARED dylibs (libsherpa-onnx-c-api.dylib ~4MB and
# libonnxruntime.*.dylib ~34MB) that live inside the Go module cache. The
# built binary gets an LC_RPATH pointing INTO the module cache, which works on
# the dev machine but breaks anywhere the cache is absent (e.g. Homebrew
# installs, copied .app bundles).
#
# Fix (proven by spike): copy the dylibs into the .app's Contents/Frameworks,
# delete the module-cache rpath, add @executable_path/../Frameworks, and
# re-codesign ad-hoc (install_name_tool invalidates the signature).
#
# Usage: fixup-macos-dylibs.sh [path-to-app-binary]
#   Default binary: <repo>/build/bin/quant.app/Contents/MacOS/quant
#   Wired as the wails.json "darwin/*" postBuildHook (receives ${bin}).
#
# Idempotent: safe to run repeatedly. Exits 0 (no-op) when not on macOS, when
# the binary is not inside a packaged .app (e.g. `wails dev` builds, which run
# fine off the module cache), or when the binary does not link sherpa dylibs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${1:-$ROOT/build/bin/quant.app/Contents/MacOS/quant}"

log() { echo "[fixup-macos-dylibs] $*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  log "not macOS; skipping"
  exit 0
fi
if [ ! -f "$BIN" ]; then
  log "no binary at $BIN; skipping"
  exit 0
fi

case "$BIN" in
  *.app/Contents/MacOS/*) APP="${BIN%/Contents/MacOS/*}" ;;
  *)
    log "$BIN is not inside a packaged .app (dev build?); skipping"
    exit 0
    ;;
esac

# Which sherpa/onnxruntime dylibs does a Mach-O file want from @rpath?
needed_libs() {
  otool -L "$1" | awk '$1 ~ /^@rpath\/(libsherpa-onnx|libonnxruntime)/ {sub(/^@rpath\//, "", $1); print $1}'
}

if [ -z "$(needed_libs "$BIN")" ]; then
  log "binary does not link sherpa-onnx dylibs; nothing to do"
  exit 0
fi

# Locate the pinned sherpa-onnx-go-macos module (version comes from go.mod via
# the module system — never hardcoded).
MODDIR="$(cd "$ROOT" && go list -m -f '{{.Dir}}' github.com/k2-fsa/sherpa-onnx-go-macos)"
if [ -z "$MODDIR" ] || [ ! -d "$MODDIR/lib" ]; then
  log "ERROR: cannot locate sherpa-onnx-go-macos module lib dir (got: '$MODDIR')" >&2
  exit 1
fi

# Pick the module lib dir(s) matching the binary's architecture(s).
ARCHS="$(lipo -archs "$BIN")"
LIBDIRS=""
for arch in $ARCHS; do
  case "$arch" in
    arm64) LIBDIRS="$LIBDIRS $MODDIR/lib/aarch64-apple-darwin" ;;
    x86_64) LIBDIRS="$LIBDIRS $MODDIR/lib/x86_64-apple-darwin" ;;
    *) log "WARNING: unhandled arch '$arch'" ;;
  esac
done
LIBDIRS="${LIBDIRS# }"
if [ -z "$LIBDIRS" ]; then
  log "ERROR: no module lib dir for archs '$ARCHS'" >&2
  exit 1
fi

FRAMEWORKS="$APP/Contents/Frameworks"
mkdir -p "$FRAMEWORKS"

# copy_lib <name>: copy (or lipo-merge, for universal binaries) one dylib from
# the module cache into Contents/Frameworks and ad-hoc sign it.
copy_lib() {
  lib="$1"
  srcs=""
  for d in $LIBDIRS; do
    if [ -f "$d/$lib" ]; then
      srcs="$srcs $d/$lib"
    fi
  done
  srcs="${srcs# }"
  if [ -z "$srcs" ]; then
    log "ERROR: $lib not found under: $LIBDIRS" >&2
    exit 1
  fi
  if [ "$(echo "$srcs" | wc -w)" -gt 1 ]; then
    # shellcheck disable=SC2086 # srcs is a deliberate word list
    lipo -create -output "$FRAMEWORKS/$lib" $srcs
  else
    cp -f "$srcs" "$FRAMEWORKS/$lib"
  fi
  chmod 755 "$FRAMEWORKS/$lib" # module cache files are read-only
  codesign -f -s - "$FRAMEWORKS/$lib"
  log "bundled $lib"
}

# Copy the binary's direct sherpa deps plus their transitive sherpa deps
# (libsherpa-onnx-c-api.dylib itself wants @rpath/libonnxruntime...).
copied=" "
queue="$BIN"
while [ -n "$queue" ]; do
  next=""
  for f in $queue; do
    for lib in $(needed_libs "$f"); do
      case "$copied" in *" $lib "*) continue ;; esac
      copy_lib "$lib"
      copied="$copied$lib "
      next="$next $FRAMEWORKS/$lib"
    done
  done
  queue="${next# }"
done

# Replace the module-cache rpath with @executable_path/../Frameworks.
rpaths="$(otool -l "$BIN" | awk '/LC_RPATH/{grab=2; next} grab && /path /{print $2; grab=0}')"
for rp in $rpaths; do
  case "$rp" in
    *sherpa-onnx-go-macos*)
      install_name_tool -delete_rpath "$rp" "$BIN"
      log "deleted module-cache rpath: $rp"
      ;;
  esac
done
case "$rpaths" in
  *"@executable_path/../Frameworks"*) : ;; # already present
  *)
    install_name_tool -add_rpath "@executable_path/../Frameworks" "$BIN"
    log "added rpath @executable_path/../Frameworks"
    ;;
esac

# install_name_tool invalidated the signature; re-sign ad-hoc. Signing the
# bundle re-seals its resources (needs an Info.plist, which packaged wails
# builds always have).
codesign -f -s - "$BIN"
if [ -f "$APP/Contents/Info.plist" ]; then
  codesign -f -s - "$APP"
  log "re-signed $APP"
else
  log "no Info.plist; signed the binary only"
fi
log "done"
