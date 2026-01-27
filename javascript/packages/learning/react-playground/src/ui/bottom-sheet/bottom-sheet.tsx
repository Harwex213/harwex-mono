import { TouchEventHandler, useEffect, useRef, useState, type FC, type PropsWithChildren } from "react";
import { } from "react";
import { router } from "../router-di";
import classes from "./bottom-sheet.module.css";

const BottomSheet: FC<PropsWithChildren<{ onClose: () => void }>> = ({ children, onClose }) => {
    const bottomSheetRef = useRef<HTMLDivElement>(null);

    const state = {
        bottomSheetHeight: 0,
        isMouseDown: false,
        mouseY: 0,
        translateY: 0,
    };

    useEffect(() => {
        const bottomSheet = bottomSheetRef.current;
        if (!bottomSheet) {
            return;
        }

        const handleTouchEnd = (e: TouchEvent) => {
            if (!state.isMouseDown) {
                return;
            }

            state.isMouseDown = false;

            const shouldHide = state.translateY / state.bottomSheetHeight >= 0.13;

            const from = state.translateY;
            const to = shouldHide ? state.bottomSheetHeight : 0;

            const animation = bottomSheet.animate([
                { transform: `translateY(${from}px)` },
                { transform: `translateY(${to}px)` }
            ], {
                duration: 250,
                easing: "ease-in-out"
            });

            const onFinish = () => {
                if (shouldHide) {
                    state.translateY = 0;
                    bottomSheet.style.transform = `translateY(${state.bottomSheetHeight}px)`;
                    onClose();

                    return;
                }
                state.translateY = 0;
                bottomSheet.style.transform = `translateY(${state.translateY}px)`;
            };

            animation.onfinish = onFinish;
            animation.oncancel = onFinish;
            animation.onremove = onFinish;
        };

        const handleTouchCancel = () => {
            state.isMouseDown = false;
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (!state.isMouseDown) {
                return;
            }

            state.translateY += e.touches[0].clientY - state.mouseY
            bottomSheet.style.transform = `translateY(${state.translateY}px)`;
            state.mouseY = e.touches[0].clientY;
        };

        window.addEventListener("touchend", handleTouchEnd);
        window.addEventListener("touchcancel", handleTouchCancel);
        window.addEventListener("touchmove", handleTouchMove);

        const resizeObserver = new ResizeObserver((e) => {
            for (const resizeObserverEntry of e) {
                state.bottomSheetHeight = resizeObserverEntry.contentRect.height;
            }
        });
        resizeObserver.observe(bottomSheet);

        return () => {
            window.removeEventListener("touchend", handleTouchEnd);
            window.removeEventListener("touchcancel", handleTouchCancel);
            window.removeEventListener("touchmove", handleTouchMove);

            resizeObserver.disconnect();
        }
    }, []);

    const handleHeaderTouchStart: TouchEventHandler<HTMLDivElement> = (e) => {
        state.isMouseDown = true;
        state.mouseY = e.touches[0].clientY;
    };

    return (
        <div className={classes.bottomSheet} ref={bottomSheetRef}>
            <div className={classes.bottomSheetHeader} onTouchStart={handleHeaderTouchStart}>
                <div className={classes.stroke} />
            </div>

            <div className={classes.bottomSheetContent}>
                {children}
            </div>
        </div>
    );
};

const BottomSheetUsage = () => {
    const [isOpen, setIsOpen] = useState(false);

    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);

    return (
        <div>
            <button onClick={open}>
                Open
            </button>

            {
                isOpen ? (
                    <BottomSheet onClose={close}>
                        <div>
                            Content
                        </div>
                    </BottomSheet>
                ) : null
            }

        </div>
    );
};

router.registerRoute("/bottom-sheet", BottomSheetUsage);