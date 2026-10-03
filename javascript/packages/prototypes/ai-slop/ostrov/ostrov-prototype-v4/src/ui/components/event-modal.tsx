import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TDismissEventModalAction } from "../../domain/registry";

/**
 * What the toxic trail threw at the player this phase (plan §3.6). The effect
 * has already been applied by the time the modal opens; the modal only tells
 * the story and takes the acknowledgement.
 */

type TEventModalRegistrySlice = {
  dismissEventModal: TDismissEventModalAction;
};

type TEventModalProps = {
  registry: TEventModalRegistrySlice;
};

const OK_LABEL_RU = "Ок";

const EventModal: FC<TEventModalProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const event = store.ui.eventModal.value;
  if (event === null) {
    return null;
  }

  return (
    <div className="event-modal__backdrop">
      <div className="event-modal" role="dialog" aria-label={event.titleRu}>
        <h3 className="event-modal__title">
          {event.titleRu}
        </h3>

        <p className="event-modal__text">
          {event.textRu}
        </p>

        <button type="button" className="event-modal__ok" onClick={() => registry.dismissEventModal()}>
          {OK_LABEL_RU}
        </button>
      </div>
    </div>
  );
};

export type { TEventModalRegistrySlice };
export { EventModal };
