**Do not start task by any chance in case when user provide your link to working files from inner worktree while you are on master worktree.**  

**Never write to the local auto-memory** (`~/.claude/projects/*/memory/`). It lives on one machine and does not reach other computers. Knowledge for future sessions goes into a `CLAUDE.md` in the repository. When a `CLAUDE.md` grows too long, move details into a `.md` file under `docs/` and leave a link to it in the `CLAUDE.md`.

Rust projects live in `rust/<name>`, not in `javascript/`.
