# remote-imagegen-mcp

A local MCP server (stdio) that generates images on a remote server.
The agent passes file paths. This server reads the reference images, sends them to the remote server, and writes the result to disk.

## Setup

You need a token for the remote server.

Claude Code:

```bash
claude mcp add remote-imagegen -e REMOTE_IMAGEGEN_TOKEN=your-token -- npx -y remote-imagegen-mcp
```

Or in an MCP config file:

```json
{
  "mcpServers": {
    "remote-imagegen": {
      "command": "npx",
      "args": ["-y", "remote-imagegen-mcp"],
      "env": {
        "REMOTE_IMAGEGEN_TOKEN": "your-token"
      }
    }
  }
}
```

Environment variables:

- `REMOTE_IMAGEGEN_TOKEN` (required): sent as `Authorization: Bearer <token>`.
- `REMOTE_IMAGEGEN_URL` (optional): defaults to `https://imagegen.harwexworld.com/mcp`.

Codex users: one generation takes up to 5 minutes, so raise the tool timeout in `~/.codex/config.toml`:

```toml
[mcp_servers.remote-imagegen]
command = "npx"
args = ["-y", "remote-imagegen-mcp"]
env = { REMOTE_IMAGEGEN_TOKEN = "your-token" }
tool_timeout_sec = 600
```

## Tool: `generate_image`

| Parameter | Required | Description |
| --- | --- | --- |
| `prompt` | yes | Full description of the image. |
| `images` | no | Up to 5 paths to reference images (png, jpg, jpeg, webp). |
| `size` | no | `1024x1024`, `1536x1024`, `1024x1536` or `auto`. |
| `output_path` | yes | Where to save the image. Missing folders are created, an existing file is overwritten. |

Relative paths resolve against the working directory of the server.
The result is a PNG. The file gets the bytes as they are, whatever extension `output_path` has.
The tool returns the saved path and the image itself as a preview.

Requires Node.js 20 or newer.
