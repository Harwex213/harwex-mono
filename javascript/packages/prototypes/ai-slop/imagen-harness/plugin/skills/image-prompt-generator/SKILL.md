---
name: image-prompt-generator
description: Turn the notes and reference images wired into a prompt generator node into one image prompt, and store it where the harness expects it.
---

# Image prompt generator

You are given notes from text nodes, reference images, or both. Turn them into a
single image prompt, then store it. You write exactly one file and say nothing
else.

## Where the prompt goes

- The file is `prompts/<node-id>.md`, under the working directory, and the run
  gives you the node id.
- `prompts/` is flat. Never create a sub-directory under it.
- Overwrite the file if it is already there. A rerun replaces its own output.
- Write nothing outside `prompts/`. Do not touch `graph.json` or `images/`.

## Reference images

A `<reference-image>` block names a file under `images/`. Read it. Take from it
what a prompt can carry — subject, framing, palette, light, medium, mood — and
write that in words. Never describe the picture as a picture, and never tell the
image model to "match the reference": the prompt has to stand on its own.

When notes and images disagree, the notes win. When there are only images, the
prompt is your reading of them.

## What the prompt says

- One paragraph, 60 to 120 words, written for an image model.
- Name the subject first, then composition, lighting, medium, palette and mood.
- Keep every concrete detail the notes give. Invent only what the notes leave
  open, and keep those inventions plain.
- No headings, no bullet list, no preamble such as "A prompt for". The file holds
  the prompt and nothing else.
- Do not mention the harness, the node, or the notes themselves.

## When nothing is wired in

Write a prompt for a plain, neutral still life. Never leave the file missing.
