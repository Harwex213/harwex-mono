import { useCallback, useEffect, useRef, useState, type FC, type KeyboardEvent } from "react";
import clsx from "clsx";
import { router } from "../router-di";
import classes from "./three-side-slider.module.css";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SliderItem {
    id: number;
    title: string;
    description: string;
    image: string;
    alt: string;
}

// ── Data ───────────────────────────────────────────────────────────────────────

const sliderData: SliderItem[] = [
    {
        id: 0,
        title: "Mountains of Serenity",
        description: "Explore breathtaking peaks where the sky meets the earth in perfect harmony.",
        image: "https://picsum.photos/seed/mountain/800/600",
        alt: "Mountain landscape",
    },
    {
        id: 1,
        title: "Ocean Depths",
        description: "Dive into the vast blue expanse and discover wonders hidden beneath the waves.",
        image: "https://picsum.photos/seed/ocean/800/600",
        alt: "Ocean view",
    },
    {
        id: 2,
        title: "Forest Trails",
        description: "Wander through ancient woodland paths where sunlight filters through the canopy.",
        image: "https://picsum.photos/seed/forest/800/600",
        alt: "Forest path",
    },
];

// ── Hook ───────────────────────────────────────────────────────────────────────

function useSlider(itemCount: number, autoPlayInterval = 4000) {
    const [activeIndex, setActiveIndex] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const resetTimer = useCallback(() => {
        if (!autoPlayInterval) return;
        clearInterval(timerRef.current!);
        timerRef.current = setInterval(() => {
            setActiveIndex(i => (i + 1) % itemCount);
        }, autoPlayInterval);
    }, [autoPlayInterval, itemCount]);

    useEffect(() => {
        resetTimer();
        return () => clearInterval(timerRef.current!);
    }, [resetTimer]);

    const goTo = useCallback((index: number) => {
        setActiveIndex(index);
        resetTimer();
    }, [resetTimer]);

    const next = useCallback(() => {
        setActiveIndex(i => (i + 1) % itemCount);
        resetTimer();
    }, [itemCount, resetTimer]);

    const prev = useCallback(() => {
        setActiveIndex(i => (i - 1 + itemCount) % itemCount);
        resetTimer();
    }, [itemCount, resetTimer]);

    // Keyboard navigation
    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === "ArrowRight") next();
            if (e.key === "ArrowLeft") prev();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [next, prev]);

    return { activeIndex, goTo };
}

// ── SliderCard ─────────────────────────────────────────────────────────────────

interface SliderCardProps {
    item: SliderItem;
    index: number;
    isActive: boolean;
    onClick: () => void;
}

const SliderCard: FC<SliderCardProps> = ({ item, index, isActive, onClick }) => {
    const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
        }
    };

    return (
        <article
            role="button"
            tabIndex={0}
            aria-expanded={isActive}
            aria-label={item.title}
            onClick={onClick}
            onKeyDown={handleKeyDown}
            className={clsx(classes.sliderCard, isActive && classes.sliderCardActive)}
        >
            <img
                src={item.image}
                alt={item.alt}
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
                className={classes.sliderCardImage}
            />
            <div className={clsx(classes.sliderCardContent, isActive && classes.sliderCardContentVisible)}>
                <h2 className={classes.sliderCardTitle}>{item.title}</h2>
                <p className={classes.sliderCardDescription}>{item.description}</p>
            </div>
        </article>
    );
};

// ── SliderDots ─────────────────────────────────────────────────────────────────

interface SliderDotsProps {
    count: number;
    activeIndex: number;
    onDotClick: (index: number) => void;
}

const SliderDots: FC<SliderDotsProps> = ({ count, activeIndex, onDotClick }) => (
    <div className={classes.sliderDots} role="tablist" aria-label="Slider navigation">
        {Array.from({ length: count }).map((_, i) => (
            <button
                key={i}
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => onDotClick(i)}
                className={clsx(classes.sliderDot, i === activeIndex && classes.sliderDotActive)}
            >
                <span className={classes.sliderDotInner} />
            </button>
        ))}
    </div>
);

// ── Slider ─────────────────────────────────────────────────────────────────────

const Slider: FC<{ items: SliderItem[] }> = ({ items }) => {
    const { activeIndex, goTo } = useSlider(items.length);
    const trackRef = useRef<HTMLDivElement>(null);

    // Sync state → native scroll (dots, auto-play, keyboard — used on mobile)
    useEffect(() => {
        trackRef.current?.scrollTo({
            left: activeIndex * (trackRef.current.offsetWidth),
            behavior: "smooth",
        });
    }, [activeIndex]);

    // Sync native scroll → state (mobile touch swipe)
    // Uses scrollend to only update after the scroll settles
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;

        const onScrollEnd = () => {
            const index = Math.round(el.scrollLeft / el.offsetWidth);
            goTo(index);
        };

        el.addEventListener("scrollend", onScrollEnd, { passive: true });
        return () => el.removeEventListener("scrollend", onScrollEnd);
    }, [goTo]);

    return (
        <div className={classes.container}>
            <div ref={trackRef} className={classes.sliderTrack}>
                {items.map((item, i) => (
                    <SliderCard
                        key={item.id}
                        item={item}
                        index={i}
                        isActive={i === activeIndex}
                        onClick={() => goTo(i)}
                    />
                ))}
            </div>
            <SliderDots count={items.length} activeIndex={activeIndex} onDotClick={goTo} />
        </div>
    );
};

// ── Route entry ────────────────────────────────────────────────────────────────

const ThreeSideSlider = () => <Slider items={sliderData} />;

router.registerRoute("/three-side-slider", ThreeSideSlider);
