import { signal } from "@hw/signals";

const currentPath = signal(typeof window !== "undefined" ? window.location.pathname : "");

const push = (url) => {
    if (window.location === url) {
        return;
    }

    try {
        window.history.pushState(null, "", url);
        this.currentPath.value = url;
    } catch (error) {
        if (error instanceof DOMException && error.name === "DataCloneError") {
            throw error;
        }
        window.location.assign(url);
    }
};

const router = {
    currentPath,
    push,
};

export { router };
