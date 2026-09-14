/**
 * The names this package answers to. The CLI is installed on PATH as
 * `headless-blender`; the MCP server introduces itself to a host as
 * `headless-blender-mcp`.
 */

/** The executable name, as it appears on PATH and in the usage text. */
const CLI_NAME = "headless-blender";
/** The name the MCP server reports in its handshake. */
const SERVER_NAME = "headless-blender-mcp";
const SERVER_VERSION = "1.0.0";

/** The Blender executable, when the caller names none. */
const ENV_BLENDER = "HEADLESS_BLENDER_BIN";
/** A `python3` for the documentation tools. */
const ENV_PYTHON = "HEADLESS_BLENDER_PYTHON";
/** The `.blend` to open when no `--blend` is given. */
const ENV_BLEND = "HEADLESS_BLENDER_BLEND";

export { CLI_NAME, ENV_BLEND, ENV_BLENDER, ENV_PYTHON, SERVER_NAME, SERVER_VERSION };
