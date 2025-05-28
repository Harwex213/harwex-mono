const throwError = (message = "Internal library error") => throw new Error(message);

const observeResize = (() => {
    const subscribers = new WeakMap();
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            let width;
            let height;
            if (entry.contentBoxSize) {
                if (entry.contentBoxSize[0]) {
                    width = entry.contentBoxSize[0].inlineSize;
                    height = entry.contentBoxSize[0].blockSize;
                } else {
                    // legacy
                    width = entry.contentBoxSize.inlineSize;
                    height = entry.contentBoxSize.blockSize;
                }
            } else {
                // legacy
                width = entry.contentRect.width;
                height = entry.contentRect.height;
            }
            const notify = subscribers.get(entry.target);
            if (notify) {
                notify(width, height);
            }
        }
    });

    return (element, notify) => {
        subscribers.set(element, notify);
        resizeObserver.observe(element, { box: "content-box" });
        return () => subscribers.delete(element);
    };
})();

export { throwError, observeResize };
