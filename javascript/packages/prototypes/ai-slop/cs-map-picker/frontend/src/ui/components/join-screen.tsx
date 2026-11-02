import { useState } from "react";
import type { FC, FormEvent } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../domain/registry";
import { extractPickId } from "../../domain/router";
import { useStore } from "../../store/store";

type TJoinScreenProps = {
  registry: TAppRegistry;
};

const JoinScreen: FC<TJoinScreenProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const [input, setInput] = useState("");
  const id = extractPickId(input);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (id) {
      void registry.joinPick(id);
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h1>Присоединиться к пикам</h1>
      <label className="field">
        <span>Код или ссылка от соперника</span>
        <input autoFocus value={input} placeholder="например, k7m2xq9p" onChange={(event) => setInput(event.target.value)} />
      </label>
      {store.formError.value && <div className="error">{store.formError.value}</div>}
      <div className="form-actions">
        <button type="button" className="button" onClick={() => registry.navigate({ name: "home" })}>
          Назад
        </button>
        <button type="submit" className="button button-primary" disabled={!id || store.formBusy.value}>
          Присоединиться
        </button>
      </div>
    </form>
  );
};

export { JoinScreen };
