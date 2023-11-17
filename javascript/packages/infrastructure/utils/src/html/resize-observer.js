const observeResize = (() => {
    let subscribers;
    let resizeObserver;

    if (typeof ResizeObserver !== "undefined") {
        subscribers = new WeakMap();
        resizeObserver = new ResizeObserver((entries) => {
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
    }

    return (element, notify, immediately) => {
        if (!resizeObserver) {
            throw new Error("@hw/utils: ResizeObserver is not implemented");
        }

        subscribers.set(element, notify);
        resizeObserver.observe(element, { box: "content-box" });

        if (immediately) {
            const boundingRect = element.getBoundingClientRect();
            notify(boundingRect.width, boundingRect.height);
        }
    };
})();

export { observeResize };
