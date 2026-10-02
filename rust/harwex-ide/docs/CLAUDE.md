# docs/

**For the coordinator only.** These are the rules for keeping `docs/` in order. A subagent that is not the coordinator ignores this file: its prompt says which task file to read and update.

The rest of the coordinator workflow (splitting work, the subagent prompt, talking to the user) is in `skills/coordinator/SKILL.md`. The two files do not repeat each other.

Files here only live as long as they are useful. Ever-growing files fill a subagent's context before its work starts, so nothing in `docs/` is append-only.

| File | Content | Lifetime |
|---|---|---|
| `backlog.md` | One line per task, with a link to its task file. Known gaps that nobody works on are `[idea]` lines without a task file | The line is deleted when the task closes or the gap is gone |
| `tasks/<id>-<slug>.md` | One task: goal, file ownership, contract, done criteria, `status:`, progress log | The file is deleted when the task closes |
| `<topic>.md` (`architecture.md`, `testing.md`, …) | Reference that is needed only sometimes | Permanent; loaded lazily through a link from a `CLAUDE.md` |
| `usage.md` | User manual, in Russian | Permanent; updated with every user-visible change |

Task file layout:

```
# <id> <title>
status: queued | active | review | done
owner: <which agent, which folders and files>

## Goal
## Contract (API, names, what must not be touched)
## Done when
## Progress (the agent appends as it goes: done, broken, timings)
```

Rules:

- A new user request goes into `backlog.md` first. A request for a task that is already running goes into that task's file. Requirements that live only in a prompt get lost.
- A subagent reads the root `CLAUDE.md`, the `CLAUDE.md` of each module it touches, and its own task file. It reads other docs only when a `CLAUDE.md` links them and the task needs them.
- The task's status lives in its file. There is no project-wide status log.
- Closing a task is mandatory:
  1. Move durable knowledge into the module's `CLAUDE.md`: new contracts, rules and traps. No history.
  2. Keep `CLAUDE.md` short: about 80 lines at the root, about 50 in a module. Move details into `docs/<topic>.md` and leave a one-line link ("read `docs/x.md` when you do Y").
  3. Delete the task file and its backlog line. git keeps the history.
- Delete stale lines at once. A wrong line in a `CLAUDE.md` is worse than a missing one, because agents trust it.
- Never use the local auto-memory (`~/.claude/projects/*/memory/`) for project knowledge. It does not reach other machines.
- `CLAUDE.md` edits change what future agents do. Show every `CLAUDE.md` diff to the user for review.
