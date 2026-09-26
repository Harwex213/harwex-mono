import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TCloseTrailEventAction } from "../../domain/registry";

type TTrailEventModalRegistrySlice = {
  closeTrailEventAction: TCloseTrailEventAction;
};

type TTrailEventModalProps = {
  registry: TTrailEventModalRegistrySlice;
};

/** What the toxic trail threw at the island this turn. */
const TrailEventModal: FC<TTrailEventModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const event = store.world.trailEvent.value;

  if (!event) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={registry.closeTrailEventAction}>
      <div className="panel modal" onClick={(click) => click.stopPropagation()}>
        <h2 className="modal__title">
          {event.title}
        </h2>

        <p className="modal__text">
          {event.text}
        </p>

        <div className="modal__buttons">
          <button type="button" className="button" onClick={registry.closeTrailEventAction}>
            {"Ясно"}
          </button>
        </div>
      </div>
    </div>
  );
};

export { TrailEventModal };
