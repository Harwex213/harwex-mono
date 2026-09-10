import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { agentInfo } from "../../shared/agents.js";
import type { AgentModel } from "../../shared/agents.js";
import type { ReasoningEffort, TabState } from "../../shared/types.js";
import {
  addAttachment,
  attachmentsByTab,
  cancel,
  removeAttachment,
  send,
  setTabAgent,
} from "../state/store.js";

/**
 * A tab that holds a slug its agent's list does not name keeps it and shows
 * it: a model retired from the list, or one released after the list was
 * written, must not silently turn into something else.
 */
function modelOptions(models: AgentModel[], current: string): AgentModel[] {
  if (current.length === 0 || models.some((entry) => entry.slug === current)) {
    return models;
  }
  return [...models, { slug: current, label: `${current} (not listed)` }];
}

/**
 * Where the description goes: a multi-line field, pictures dropped, pasted or
 * chosen, and the screenshots the viewer hands over. Cmd/Ctrl + Enter sends;
 * Enter alone is a new line.
 *
 * The model and the effort sit above the field rather than in the settings,
 * because they belong to one file. They are settled before the first message
 * and fixed after it: the session the next message resumes was built by that
 * pair, so changing either mid-conversation would change what the agent is
 * halfway through being.
 */
function Composer({ state }: { state: TabState }): React.JSX.Element {
  useSignals();
  const tabId = state.tab.id;
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = attachmentsByTab.value[tabId] ?? [];
  const started = state.conversationStarted;
  const canSend = state.blender === "ready" && !state.running && text.trim().length > 0;
  const agent = agentInfo(state.tab.agentKind);
  const model = state.tab.agentModel;
  const effort = state.tab.reasoningEffort;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    area.style.height = "0px";
    area.style.height = `${Math.min(Math.max(area.scrollHeight, 72), 280)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) {
      return;
    }
    const message = text;
    setText("");
    void send(tabId, message);
  };

  const takeFiles = (files: FileList | File[] | null) => {
    if (!files) {
      return;
    }
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        void addAttachment(tabId, file, file.name || "image.png");
      }
    }
  };

  return (
    <div
      className="composer"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        takeFiles(event.dataTransfer.files);
      }}
    >
      {agent ? (
        <div className="composer__agent">
          <select
            className="composer__model"
            value={model}
            title={
              started
                ? "The model is fixed for this conversation. Clear it to choose another."
                : "The model this file's runs use. Default uses the agent's own."
            }
            disabled={started || state.running}
            onChange={(event) => {
              void setTabAgent(tabId, event.target.value, effort);
            }}
          >
            {modelOptions(agent.models, model).map((entry) => {
              return (
                <option key={entry.slug} value={entry.slug}>
                  {entry.label}
                </option>
              );
            })}
          </select>
          <select
            className="composer__effort"
            value={effort}
            title={
              started
                ? "The reasoning effort is fixed for this conversation. Clear it to choose another."
                : "Reasoning effort for this file. Default uses the agent's own."
            }
            disabled={started || state.running}
            onChange={(event) => {
              void setTabAgent(tabId, model, event.target.value as ReasoningEffort);
            }}
          >
            {agent.efforts.map((entry) => {
              return (
                <option key={entry} value={entry}>
                  {entry === "" ? "effort: default" : `effort: ${entry}`}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => {
            return (
              <div key={attachment.id} className="attachment" title={attachment.name}>
                <img src={attachment.url} alt={attachment.name} />
                <button
                  type="button"
                  className="attachment__remove"
                  title="Remove"
                  onClick={() => {
                    removeAttachment(tabId, attachment.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <textarea
        ref={areaRef}
        className="composer__input"
        value={text}
        placeholder={
          started
            ? "What should change? Cmd/Ctrl + Enter sends."
            : "Describe the model to build. What it is, its size, materials, purpose…"
        }
        disabled={state.running}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onPaste={(event) => {
          const items = Array.from(event.clipboardData.items);
          const images = items.filter((item) => item.type.startsWith("image/"));
          if (images.length === 0) {
            return;
          }
          event.preventDefault();
          for (const item of images) {
            const file = item.getAsFile();
            if (file) {
              void addAttachment(tabId, file, "pasted.png");
            }
          }
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer__row">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            takeFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="button button--small"
          title="Attach pictures for the agent to work from"
          disabled={state.running}
          onClick={() => {
            fileRef.current?.click();
          }}
        >
          +
        </button>
        <span className="composer__hint">{state.blender !== "ready" ? `Blender is ${state.blender}.` : ""}</span>
        {state.running ? (
          <button
            type="button"
            className="button button--small button--danger"
            onClick={() => {
              cancel(tabId);
            }}
          >
            Cancel run
          </button>
        ) : (
          <button type="button" className="button button--small button--primary" disabled={!canSend} onClick={submit}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

export { Composer };
