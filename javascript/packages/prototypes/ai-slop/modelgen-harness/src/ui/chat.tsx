import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, MessageImage } from "../../shared/types.js";
import { imageUrl } from "../state/bridge.js";
import { messagesByTab } from "../state/store.js";

function Picture({ image, large }: { image: MessageImage; large: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const label = image.kind === "preview" ? "preview" : image.kind === "generated" ? "reference" : "attached";
  return (
    <figure
      className={`picture picture--${image.kind}${open || large ? " picture--large" : ""}`}
      title={image.filePath ?? label}
      onClick={() => {
        setOpen(!open);
      }}
    >
      <img src={imageUrl(image.id)} alt={label} width={image.width} height={image.height} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function Progress({ message }: { message: ChatMessage }): React.JSX.Element {
  const [open, setOpen] = useState(message.status === "running");
  const lines = message.text.split("\n");
  const head = lines[0] ?? "";
  const steps = lines.slice(1).filter((line) => line.trim().length > 0);
  useEffect(() => {
    if (message.status === "running") {
      setOpen(true);
    }
  }, [message.status]);
  return (
    <div className={`message message--progress message--${message.status}`}>
      <button
        type="button"
        className="progress__head"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="progress__spinner" />
        <span className="progress__summary">{head}</span>
        <span className="progress__count">{steps.length} step{steps.length === 1 ? "" : "s"}</span>
      </button>
      {open && steps.length > 0 ? (
        <ol className="progress__steps">
          {steps.map((step, index) => {
            return <li key={index}>{step.replace(/^▸\s*/, "")}</li>;
          })}
        </ol>
      ) : null}
    </div>
  );
}

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === "progress") {
    return <Progress message={message} />;
  }
  const previews = message.images.filter((image) => image.kind === "preview");
  const others = message.images.filter((image) => image.kind !== "preview");
  return (
    <div className={`message message--${message.role} message--${message.status}`}>
      <div className="message__body">
        {message.text.length > 0 ? (
          <p className="message__text">{message.text}</p>
        ) : message.status === "running" ? (
          <p className="message__text message__text--muted">Working…</p>
        ) : null}
        {others.length > 0 ? (
          <div className="message__pictures">
            {others.map((image) => {
              return <Picture key={image.id} image={image} large={false} />;
            })}
          </div>
        ) : null}
      </div>
      {previews.length > 0 ? (
        <div className="message__previews">
          {previews.map((image, index) => {
            return <Picture key={image.id} image={image} large={index === previews.length - 1} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

function Chat({ tabId }: { tabId: string }): React.JSX.Element {
  useSignals();
  const list = messagesByTab.value[tabId] ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastKey = list.length > 0 ? `${list[list.length - 1]?.id}:${list[list.length - 1]?.text.length}` : "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastKey]);

  return (
    <div className="chat__scroll">
      {list.length === 0 ? (
        <div className="chat__empty">
          <h3>Describe the model</h3>
        </div>
      ) : null}
      {list.map((message) => {
        return <Message key={message.id} message={message} />;
      })}
      <div ref={bottomRef} />
    </div>
  );
}

export { Chat };
