import { useState } from "preact/hooks";
import { GAMES_PATH, navigate } from "./router";
import { signIn } from "./session";

// The gate: nothing else in the shell can render without a session, and signing in
// is a round trip now, so the field has two states the local version never had —
// in flight, and refused. One field, centred, submitted with Enter; a form rather
// than a keydown handler so the browser's own submit behaviour does the work.
function NamePage() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = draft.trim();

  const submit = async () => {
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(trimmed);
      navigate(GAMES_PATH);
    } catch (cause) {
      // Nearly always the backend not running — say so rather than leave the field
      // looking inert.
      setError(cause instanceof Error ? cause.message : "could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell shell-center">
      <form
        className="name-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          className="text-field"
          type="text"
          value={draft}
          placeholder="player name"
          aria-label="player name"
          maxLength={24}
          disabled={busy}
          autoFocus
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        {error ? <p className="shell-error">{error}</p> : null}
      </form>
    </div>
  );
}

export { NamePage };
