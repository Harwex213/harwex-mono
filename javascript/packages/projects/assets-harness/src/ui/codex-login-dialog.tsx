import { useSignals } from "@preact/signals-react/runtime";
import { changeCodexLogin, codexLogin, codexLoginBusy } from "../state/store.js";

/**
 * The prompt the app opens with while the image tool has no ChatGPT login.
 * The login goes to the SQLite database, so the prompt shows up once. It has
 * no Cancel: the image tool of a Claude run does not work without the login.
 */
function CodexLoginDialog(): React.JSX.Element {
  useSignals();
  const busy = codexLoginBusy.value;

  return (
    <div className="modal">
      <div className="dialog">
        <h2>Sign in with ChatGPT</h2>
        <p>
          The Codex SDK generates pictures for Claude runs on your ChatGPT account. Sign in once. The app stores the
          login in its SQLite database.
        </p>
        {busy ? <small>Finish the sign-in in the browser…</small> : null}
        <div className="dialog__actions">
          {codexLogin.value?.canImport ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                void changeCodexLogin("importCurrent");
              }}
            >
              Use the codex CLI login
            </button>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => {
              void changeCodexLogin("login");
            }}
          >
            Sign in with ChatGPT
          </button>
        </div>
      </div>
    </div>
  );
}

export { CodexLoginDialog };
