#!/usr/bin/env bash
# Symlink executables from a folder into a bin dir that is on PATH.
#
# Usage: add-path-symlink.sh <folder|file> [bin-dir]
#   bin-dir defaults to ~/.local/bin
#
# If a command with the same name already exists, the script asks:
#   [o]verwrite  [s]kip  [A]ll overwrite  [N]one (skip all)  [q]uit

set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <folder|file> [bin-dir]" >&2
  exit 1
}

[[ $# -ge 1 && $# -le 2 ]] || usage

SRC="$1"
BIN_DIR="${2:-$HOME/.local/bin}"

[[ -e "$SRC" ]] || { echo "Not found: $SRC" >&2; exit 1; }

abs_path() {
  local p="$1"
  if [[ -d "$p" ]]; then
    (cd "$p" && pwd -P)
  else
    echo "$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"
  fi
}

SRC="$(abs_path "$SRC")"
mkdir -p "$BIN_DIR"
BIN_DIR="$(abs_path "$BIN_DIR")"

# Collect executables: a single file, or every executable file directly in the folder.
candidates=()
if [[ -f "$SRC" ]]; then
  [[ -x "$SRC" ]] || { echo "Not executable: $SRC" >&2; exit 1; }
  candidates+=("$SRC")
else
  for f in "$SRC"/*; do
    [[ -f "$f" && -x "$f" ]] && candidates+=("$f")
  done
fi

if [[ ${#candidates[@]} -eq 0 ]]; then
  echo "No executables in $SRC"
  exit 0
fi

# Sticky answer for "all" / "none".
policy=""

# Sets $choice to overwrite | skip | quit.
ask() {
  local answer
  if [[ -n "$policy" ]]; then
    choice="$policy"
    return
  fi
  while true; do
    read -r -p "    [o]verwrite / [s]kip / [A]ll overwrite / [N]one / [q]uit? " answer || { choice=quit; return; }
    case "$answer" in
      o) choice=overwrite; return ;;
      s) choice=skip; return ;;
      A) policy=overwrite; choice=overwrite; return ;;
      N) policy=skip; choice=skip; return ;;
      q) choice=quit; return ;;
    esac
  done
}

linked=0
skipped=0

for target in "${candidates[@]}"; do
  name="$(basename "$target")"
  link="$BIN_DIR/$name"

  # Already linked to the same file: nothing to do.
  if [[ -L "$link" && "$(readlink "$link")" == "$target" ]]; then
    echo "= $name (already linked)"
    continue
  fi

  conflict=""
  if [[ -e "$link" || -L "$link" ]]; then
    if [[ -L "$link" ]]; then
      conflict="$link -> $(readlink "$link")"
    else
      conflict="$link (regular file)"
    fi
  else
    existing="$(command -v "$name" 2>/dev/null || true)"
    if [[ -n "$existing" ]]; then
      conflict="$existing (elsewhere on PATH)"
    fi
  fi

  if [[ -n "$conflict" ]]; then
    echo "! $name already exists: $conflict"
    echo "    new: $target"
    ask
    case "$choice" in
      quit) echo "Stopped."; break ;;
      skip) echo "  skipped"; skipped=$((skipped + 1)); continue ;;
    esac
  fi

  ln -sfn "$target" "$link"
  echo "+ $name -> $target"
  linked=$((linked + 1))
done

echo
echo "Linked: $linked, skipped: $skipped"

# Make sure BIN_DIR is on PATH.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    rc="$HOME/.zshrc"
    [[ "$(basename "${SHELL:-}")" == "bash" ]] && rc="$HOME/.bashrc"
    line="export PATH=\"$BIN_DIR:\$PATH\""
    if ! grep -qsF "$line" "$rc"; then
      printf '\n%s\n' "$line" >>"$rc"
      echo "Added $BIN_DIR to PATH in $rc"
    fi
    echo "Run: source $rc  (or open a new terminal)"
    ;;
esac
