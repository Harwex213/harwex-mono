import type { ContextMode } from "../../shared/types.ts";
import { useHarness } from "../state/harness.tsx";
import type { Effort } from "../state/reducer.ts";

const MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const CONTEXT_MODES: { id: ContextMode; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Auto",
    hint: "Fork the parent's agent session when it is still alive, otherwise rebuild the transcript.",
  },
  {
    id: "fork",
    label: "Fork session",
    hint: "Always resume and fork the parent's session, so only the follow-up travels in the prompt.",
  },
  {
    id: "rebuild",
    label: "Rebuild transcript",
    hint: "Always send the whole walked path as text, in a fresh session.",
  },
];

type TopBarProps = {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
};

function TopBar({ inspectorOpen, onToggleInspector }: TopBarProps) {
  const { state, dispatch, createRoot, patchSettings } = useHarness();
  const answered = state.nodes.filter((node) => {
    return node.status === "done";
  }).length;
  const contextHint = CONTEXT_MODES.find((mode) => {
    return mode.id === state.settings.contextMode;
  })?.hint;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark" />
        <input
          className="topbar__topic"
          value={state.topic}
          placeholder="Name this learning tree"
          onChange={(event) => {
            dispatch({ type: "topic/changed", topic: event.target.value });
          }}
        />
      </div>

      <div className="topbar__stats">
        {state.nodes.length} cards · {answered} answered
      </div>

      <label className="field">
        <span className="field__label">Model</span>
        <select
          className="field__control"
          value={state.settings.model}
          onChange={(event) => {
            patchSettings({ model: event.target.value });
          }}
        >
          {MODELS.map((model) => {
            return (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            );
          })}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Effort</span>
        <select
          className="field__control"
          value={state.settings.effort}
          onChange={(event) => {
            patchSettings({ effort: event.target.value as Effort });
          }}
        >
          {EFFORTS.map((effort) => {
            return (
              <option key={effort} value={effort}>
                {effort}
              </option>
            );
          })}
        </select>
      </label>

      <label className="field" title={contextHint}>
        <span className="field__label">Branch context</span>
        <select
          className="field__control"
          value={state.settings.contextMode}
          onChange={(event) => {
            patchSettings({ contextMode: event.target.value as ContextMode });
          }}
        >
          {CONTEXT_MODES.map((mode) => {
            return (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            );
          })}
        </select>
      </label>

      <button className="button button--ghost" type="button" onClick={onToggleInspector}>
        {inspectorOpen ? "Hide detail" : "Show detail"}
      </button>
      <button className="button button--primary" type="button" onClick={createRoot}>
        New question
      </button>
    </header>
  );
}

export { TopBar };
