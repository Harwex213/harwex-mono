import type { TStore } from "../../store/index";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function showError(store: TStore, message: string): void {
  store.status.error.value = message;
}

function dismissError(store: TStore): void {
  store.status.error.value = null;
}

function dismissNotice(store: TStore): void {
  store.status.notice.value = null;
}

export {
  dismissError,
  dismissNotice,
  errorMessage,
  showError,
};
