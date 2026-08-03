import { Button, Input } from "@hw/faenwald-uikit";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LOCAL_PLAYER, messages, sendMessage } from "../state/session-state";
import { SendIcon } from "../ui/icons";
import styles from "./chat-panel.module.css";

// The session chat. It reads the same log on every page, so it takes no props:
// a page just drops it into its side column and it takes the slack there.
function ChatPanel() {
  useSignals();

  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const count = messages.value.length;

  // Keep the newest message in view after every send.
  useEffect(() => {
    const log = logRef.current;
    if (log === null) {
      return;
    }
    log.scrollTop = log.scrollHeight;
  }, [count]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(draft);
    setDraft("");
  }

  return (
    <section className={styles.chat}>
      <div className={styles.chatLog} ref={logRef}>
        {messages.value.map((message) => (
          <div className={styles.message} key={message.id}>
            <span
              className={
                message.author === LOCAL_PLAYER
                  ? `${styles.messageAuthor} ${styles.messageMine}`
                  : styles.messageAuthor
              }
            >
              {message.author}
            </span>
            <span className={styles.messageText}>{message.text}</span>
          </div>
        ))}
      </div>

      <form className={styles.chatForm} onSubmit={onSubmit}>
        <Input.Root
          className={styles.chatInput}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Message…"
          value={draft}
        />
        <Button.Root
          aria-label="Send"
          className={styles.sendButton}
          disabled={draft.trim().length === 0}
          size="sm"
          type="submit"
        >
          <SendIcon className={styles.sendIcon} />
        </Button.Root>
      </form>
    </section>
  );
}

export { ChatPanel };
