import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The two skills are written into the working directory rather than shipped
 * with the app, because the agent runs with that directory as its cwd and picks
 * up `.claude/skills` from there. They are rewritten on every open, so a stale
 * copy in an old working directory cannot outlive an app update.
 */

const PROMPT_SKILL = `---
name: image-prompt-generator
description: Turn the notes and reference images wired into a prompt generator node into one image prompt, and store it where the harness expects it.
---

# Image prompt generator

You are given notes from text nodes, reference images, or both. Turn them into a
single image prompt, then store it. You write exactly one file and say nothing
else.

## Where the prompt goes

- The file is \`prompts/<node-id>.md\`, under the working directory, and the run
  gives you the node id.
- \`prompts/\` is flat. Never create a sub-directory under it.
- Overwrite the file if it is already there. A rerun replaces its own output.
- Write nothing outside \`prompts/\`. Do not touch \`graph.json\` or \`images/\`.

## Reference images

A \`<reference-image>\` block names a file under \`images/\`. Read it. Take from it
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
`;

const IMAGE_SKILL = `---
name: image-generator
description: Generate one image with the Magnific MCP server and store it where the harness expects it.
---

# Image generator

You are given a prompt, a model name, a size, and the id of the image node the
run writes into. You produce one image file and say nothing else.

## How to generate

- Use the Magnific MCP tools. They are the only way to make the image.
- Pass the model and the size through exactly as the run gave them. Do not swap
  in a model you like better, and do not resize afterwards.
- Reference images may be wired in. Pass them to the tool when it takes them.

## Where the image goes

- The file is \`images/<node-id>.png\`, under the working directory.
- \`images/\` is flat. Never create a sub-directory under it.
- Never overwrite an existing image. Every run is given a fresh node id, so a
  name that already exists means the wrong id, and you should stop and say so.
- Write nothing outside \`images/\`. Do not touch \`graph.json\` or \`prompts/\`.

## Getting the bytes to disk

The MCP tool usually answers with a URL. Download it:

\`\`\`bash
curl -fsSL "<url>" -o images/<node-id>.png
\`\`\`

If the tool hands back base64 instead, decode it to the same path. Then check
the file is there and is not empty. A run that ends with no file on disk is a
failed run, and you must say what went wrong.
`;

async function writeSkill(dir: string, name: string, body: string): Promise<void> {
  const skillDir = path.join(dir, ".claude", "skills", name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), body, "utf8");
}

async function writeSkills(dir: string): Promise<void> {
  await writeSkill(dir, "image-prompt-generator", PROMPT_SKILL);
  await writeSkill(dir, "image-generator", IMAGE_SKILL);
}

export { writeSkills };
