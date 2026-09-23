---
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

- The file is `images/<node-id>.png`, under the working directory.
- `images/` is flat. Never create a sub-directory under it.
- Never overwrite an existing image. Every run is given a fresh node id, so a
  name that already exists means the wrong id, and you should stop and say so.
- Write nothing outside `images/`. Do not touch `graph.json` or `prompts/`.

## Getting the bytes to disk

The MCP tool usually answers with a URL. Download it:

```bash
curl -fsSL "<url>" -o images/<node-id>.png
```

If the tool hands back base64 instead, decode it to the same path. Then check
the file is there and is not empty. A run that ends with no file on disk is a
failed run, and you must say what went wrong.
