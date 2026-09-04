#!/usr/bin/env bash

set -u

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)" || exit 1

status=0

while IFS= read -r -d '' claude_path; do
  agents_path="$(dirname -- "$claude_path")/AGENTS.md"

  if [[ -e "$repo_root/$agents_path" && ! -L "$repo_root/$agents_path" ]]; then
    printf 'Skipped %s: an existing non-symlink file would be overwritten.\n' "$agents_path" >&2
    status=1
    continue
  fi

  if [[ -L "$repo_root/$agents_path" ]] && [[ "$(readlink "$repo_root/$agents_path")" == "CLAUDE.md" ]]; then
    printf 'Unchanged %s -> CLAUDE.md\n' "$agents_path"
    continue
  fi

  if ln -sfn "CLAUDE.md" "$repo_root/$agents_path"; then
    printf 'Created %s -> CLAUDE.md\n' "$agents_path"
  else
    printf 'Failed to create %s.\n' "$agents_path" >&2
    status=1
  fi
done < <(git -C "$repo_root" ls-files -z -- '*CLAUDE.md')

exit "$status"
