import type {
  AgentKind,
  ChatMessage,
  ImageKind,
  MessageImage,
  MessageStatus,
} from "../shared/types.js";

/**
 * The conversations, in memory. A chat belongs to the app while it runs: the
 * messages, the pictures they show, the agent session the next message
 * resumes, and what the conversation has spent. None of it is written down —
 * SQLite holds the models, and a model is what is worth keeping.
 *
 * What survives a restart is the `.blend` itself. Reopening the app opens the
 * same files with empty chats, and the first message of each starts a fresh
 * agent session against a scene that is already built.
 */

/** A picture the chat shows, with the bytes the `modelgen://image` handler serves. */
interface StoredImage extends MessageImage {
  mime: string;
  bytes: Uint8Array;
}

const messages = new Map<string, ChatMessage[]>();
const byId = new Map<string, ChatMessage>();
const pictures = new Map<string, StoredImage>();
const sessions = new Map<string, { agentKind: AgentKind; sessionId: string }>();
const counts = new Map<string, { used: number; cached: number }>();

/** A copy, so the renderer never holds the object the next update rewrites. */
function snapshot(message: ChatMessage): ChatMessage {
  return { ...message, images: message.images.map((image) => ({ ...image })) };
}

function insertMessage(message: Omit<ChatMessage, "images">): ChatMessage {
  const stored: ChatMessage = { ...message, images: [] };
  const list = messages.get(message.tabId) ?? [];
  list.push(stored);
  messages.set(message.tabId, list);
  byId.set(stored.id, stored);
  return snapshot(stored);
}

function updateMessage(id: string, text: string, status: MessageStatus): void {
  const stored = byId.get(id);
  if (!stored) {
    return;
  }
  stored.text = text;
  stored.status = status;
}

function readMessage(id: string): ChatMessage | null {
  const stored = byId.get(id);
  return stored ? snapshot(stored) : null;
}

function messagesOf(tabId: string): ChatMessage[] {
  return (messages.get(tabId) ?? []).map(snapshot);
}

/**
 * Hangs a picture off a message. The bytes stay here; the renderer is handed
 * the id and asks for them over `modelgen://image`, so no picture travels the
 * IPC channel.
 */
function insertImage(image: StoredImage & { messageId: string }): MessageImage {
  const entry: MessageImage = {
    id: image.id,
    kind: image.kind as ImageKind,
    width: image.width,
    height: image.height,
    filePath: image.filePath,
  };
  pictures.set(image.id, { ...entry, mime: image.mime, bytes: image.bytes });
  byId.get(image.messageId)?.images.push(entry);
  return { ...entry };
}

function readImage(id: string): { mime: string; bytes: Uint8Array } | null {
  const image = pictures.get(id);
  return image ? { mime: image.mime, bytes: image.bytes } : null;
}

// ---------------------------------------------------------------------------
// Agent sessions. One per tab, resumed by the next message of the same
// conversation. Codex keeps its threads under its own home and Claude Code its
// sessions under ~/.claude; what is held here is only which one belongs to
// this tab.

/** The session of this tab, but only if the agent that owns it is still the tab's. */
function readSessionId(tabId: string, agentKind: AgentKind): string | null {
  const entry = sessions.get(tabId);
  return entry && entry.agentKind === agentKind ? entry.sessionId : null;
}

function writeSessionId(tabId: string, agentKind: AgentKind, sessionId: string): void {
  sessions.set(tabId, { agentKind, sessionId });
}

// ---------------------------------------------------------------------------
// Tokens. What the conversation has spent, not what the model has: a cleared
// chat starts both counts again.

function readTokens(tabId: string): { used: number; cached: number } {
  return counts.get(tabId) ?? { used: 0, cached: 0 };
}

/** Adds one turn's tokens to the tab's running totals and returns them. */
function addTokens(tabId: string, fresh: number, cached: number): { used: number; cached: number } {
  const total = readTokens(tabId);
  const next = { used: total.used + fresh, cached: total.cached + cached };
  counts.set(tabId, next);
  return next;
}

/**
 * Drops the conversation of one tab: its messages, the pictures hanging off
 * them, the agent session the next message would have resumed, and the token
 * count. What the agent already built in the `.blend` is untouched — only the
 * talk goes.
 */
function clearConversation(tabId: string): void {
  for (const message of messages.get(tabId) ?? []) {
    byId.delete(message.id);
    for (const image of message.images) {
      pictures.delete(image.id);
    }
  }
  messages.delete(tabId);
  sessions.delete(tabId);
  counts.delete(tabId);
}

export type { StoredImage };
export {
  addTokens,
  clearConversation,
  insertImage,
  insertMessage,
  messagesOf,
  readImage,
  readMessage,
  readSessionId,
  readTokens,
  updateMessage,
  writeSessionId,
};
