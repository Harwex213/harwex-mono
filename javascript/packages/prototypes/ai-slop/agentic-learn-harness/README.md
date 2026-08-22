# Agentic Learn Harness

A canvas for learning by branching. Every card is one question and the agent's
answer. Branch off any answer and the harness builds the prompt that carries the
path you walked into the follow-up, then runs it through
[`@anthropic-ai/claude-agent-sdk`](https://code.claude.com/docs/en/agent-sdk).

```
yarn install
yarn workspace @hw/agentic-learn-harness dev
```

`dev` starts two processes and prefixes their output: the harness server on
`:5757` and the rspack dev server on a random port (the `[web]` line prints the
URL). The dev server proxies `/api` to the harness.

Authentication comes from the machine's Claude Code credentials — the SDK spawns
the Claude Code CLI, which uses an `ant auth login` profile or `ANTHROPIC_API_KEY`.
If `claude` works in your terminal, this works.

## What the harness does

The browser never talks to the model. It posts a question plus the walked path to
`POST /api/ask` and reads the answer back as an SSE stream. The server decides
how to carry context, writes the prompt, and calls the SDK.

### Two ways to carry a branch

A branch needs the parent's conversation. There are two ways to give it, and the
**Branch context** control in the top bar picks between them:

| Mode | What the harness sends | When to use it |
| --- | --- | --- |
| `fork` | Only the follow-up question. The SDK resumes the parent's session with `forkSession: true`, so the parent's history is already in context — and mostly served from the prompt cache. | The default. Cheap, exact, and siblings never collide because each fork gets its own session id. |
| `rebuild` | The whole path as text: every ancestor question and answer inside a `<learning-path>` block, in a fresh session. | The parent's session is gone (server restarted, session pruned), or you want to see exactly what the model was told. |

`auto` forks when the parent has a session id and rebuilds otherwise. A fork that
dies before producing any text is automatically retried as a rebuild, and the
canvas says so. Each card's footer badge reports which mode actually ran, and
**Show sent prompt** in the detail panel shows the exact text that went out.

Prompt construction lives in `server/prompt.ts` — the system prompt and both
branch shapes are there, in one file, on purpose.

### Images and long text

Images upload to `POST /api/images` as raw bytes and are stored content-addressed
under `.data/images`, so pasting the same screenshot twice costs one file. The
question then references them by id, and the harness reads them off disk and
attaches them as base64 content blocks. Paste, drag-and-drop, and the file picker
all work; up to 8 images travel with one question. Because images never ride
inside the graph JSON, a question can carry a lot of text and several screenshots
without either getting large.

Ancestor images are *not* re-sent in rebuild mode — the transcript notes that an
image was attached instead.

### Tools

The agent gets `WebSearch` and `WebFetch` and nothing else: no Read, no Write, no
Bash. `settingSources: []` keeps the machine's `CLAUDE.md` and user settings out
of the session, so a lesson on Roman law does not inherit a repo's code
conventions. Tool calls show up as chips on the card.

## Layout

```
shared/types.ts     types both sides share
server/index.ts     http routing, SSE, image upload, graph read/write
server/agent.ts     drives query(), turns SDK messages into harness events
server/prompt.ts    the system prompt and the two branch prompt shapes
server/store.ts     graph.json and the image files
src/state/          reducer, harness context, tree placement
src/components/     canvas, cards, composer, detail panel
src/api/client.ts   fetch wrappers and the SSE reader
```

State lives in one reducer. The graph autosaves to `.data/graph.json` about a
second after any edit and reloads on start, so the canvas survives a refresh. A
card that was mid-answer when the page reloaded is marked done or failed — there
is no live turn left to reattach to.

Card heights are measured on screen and fed back into placement, because an
answer's length decides how far down its children have to go.

## Keys and gestures

- `Cmd`/`Ctrl` + `Enter` in a composer asks the question
- drag a card's header to move it; drag the background to pan
- `Cmd`/`Ctrl` + wheel zooms at the cursor; plain wheel pans
- `Fit` frames the whole tree

## Rough edges

- Images are never garbage collected. Deleting a card leaves its files in
  `.data/images`; delete the directory when it bothers you.
- The graph is a single document with no history. Deleting a card deletes its
  whole subtree, with no undo.
- Sessions live wherever the Claude Code CLI keeps them, keyed by `.data/agent-cwd`.
  Wiping `.data` orphans them, and every branch falls back to rebuild.
