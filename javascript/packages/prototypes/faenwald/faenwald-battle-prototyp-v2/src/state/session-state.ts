import { signal } from "@preact/signals-react";

type Player = {
  id: string;
  name: string;
  // The seat the local player sits in. Its ready flag comes from
  // `disposition-state`, the other seats are stubs until there is a server.
  isLocal: boolean;
};

type ChatMessage = {
  id: string;
  author: string;
  text: string;
};

const LOCAL_PLAYER = "Player 1";

const players: Player[] = [
  { id: "p1", name: LOCAL_PLAYER, isLocal: true },
  { id: "p2", name: "Player 2", isLocal: false },
];

const messages = signal<ChatMessage[]>([
  { id: "m0", author: "Player 2", text: "Hello world" },
]);

let nextMessageId = 1;

function sendMessage(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }

  messages.value = [...messages.value, { id: `m${nextMessageId}`, author: LOCAL_PLAYER, text: trimmed }];
  nextMessageId += 1;
}

export { LOCAL_PLAYER, messages, players, sendMessage };
export type { ChatMessage, Player };
