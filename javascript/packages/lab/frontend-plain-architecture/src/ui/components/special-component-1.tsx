import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

const SpecialComponent = () => {
  useSignals();
  const store = useStore();
  const count = store.buttonState.count.value;

  return (
    <div>
      {count}
    </div>
  );
};

export { SpecialComponent };
