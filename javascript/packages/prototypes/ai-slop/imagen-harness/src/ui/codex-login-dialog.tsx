import { useSignals } from "@preact/signals-react/runtime";
import { changeCodexLogin, codexLogin, codexLoginBusy } from "../state/codex-login.js";

/**
 * The prompt the app opens with while the image runs have no ChatGPT login.
 * The login goes to the SQLite database, so the prompt shows up once. It has
 * no Cancel: an image run does not work without the login.
 */
function CodexLoginDialog(): React.JSX.Element {
  useSignals();
  const busy = codexLoginBusy.value;

  return (
    <div className="modal">
      <div className="dialog">
        <h2>Sign in with ChatGPT</h2>
        <p>
          The Codex SDK generates the images on your ChatGPT account. Sign in once. The app stores the login in its
          SQLite database.
        </p>
        {busy ? <p className="dialog__hint">Finish the sign-in in the browser…</p> : null}
        <div className="dialog__actions">
          {codexLogin.value?.canImport ? (
            <button
              type="button"
              className="dialog__button"
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
            className="dialog__button dialog__button--primary"
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

/** Who the image runs are signed in as, with a way out. Sits on the welcome screen. */
function CodexAccount(): React.JSX.Element | null {
  useSignals();
  const login = codexLogin.value;
  if (!login?.signedIn) {
    return null;
  }
  return (
    <p className="codex-account">
      Images run on ChatGPT as {login.email || "a ChatGPT account"}.{" "}
      <button
        type="button"
        className="codex-account__out"
        disabled={codexLoginBusy.value}
        onClick={() => {
          void changeCodexLogin("logout");
        }}
      >
        Sign out
      </button>
    </p>
  );
}

export { CodexAccount, CodexLoginDialog };
