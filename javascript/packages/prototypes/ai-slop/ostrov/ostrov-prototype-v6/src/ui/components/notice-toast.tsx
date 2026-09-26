import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

/** Why the last click did nothing. Fades itself out from the domain timer. */
const NoticeToast = () => {
  useSignals();
  const store = useStore();
  const notice = store.ui.notice.value;

  if (!notice) {
    return null;
  }

  return (
    <div className="notice-toast" role="status">
      {notice}
    </div>
  );
};

export { NoticeToast };
