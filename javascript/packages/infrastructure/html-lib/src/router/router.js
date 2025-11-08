import { signal } from "@hw/signals";

const currentPath = signal(typeof window !== "undefined" ? window.location.pathname : "");

const push = (url) => {
  if (window.location === url) {
    return;
  }

  try {
    window.history.pushState({ pathname: url }, "", url);
    currentPath.value = url;
  } catch (error) {
    if (error instanceof DOMException && error.name === "DataCloneError") {
      throw error;
    }
    window.location.assign(url);
  }
};

window.addEventListener("popstate", (event) => {
  currentPath.value = window.location.pathname;
})

const router = {
  currentPath,
  push,
};

export { router };
