import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TDismissLinkErrorAction } from "@hw/harwex-notes-protocol";

type TLinkErrorLineRegistrySlice = {
  dismissLinkErrorAction: TDismissLinkErrorAction;
};

type TLinkErrorLineProps = {
  registry: TLinkErrorLineRegistrySlice;
};

// Why the last followed link opened nothing, next to the tab bar (FEED-4, EX-9).
const LinkErrorLine: FC<TLinkErrorLineProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const message = store.tabs.linkError.value;

  if (message === null) {
    return null;
  }

  return (
    <p className="link-error" role="alert">
      <span className="link-error__text">{message}</span>

      <button
        aria-label={"Dismiss"}
        className="link-error__close"
        onClick={() => registry.dismissLinkErrorAction()}
        type="button"
      >
        {"×"}
      </button>
    </p>
  );
};

export { LinkErrorLine };
