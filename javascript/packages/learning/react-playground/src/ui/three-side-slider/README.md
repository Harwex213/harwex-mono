# Feature Slider — React + TypeScript Implementation Plan

## Overview

A three-panel slider where clicking/tapping a card **expands** it to reveal a title and description, while the other two
cards shrink. The active card cycles through positions (left → center → right) across three states.

---

## 1. Component Architecture

```
<SliderSection>
  └── <Slider>
        ├── <SliderTrack>          ← flex container, animates widths
        │     ├── <SliderCard id={0} />
        │     ├── <SliderCard id={1} />
        │     └── <SliderCard id={2} />
        └── <SliderDots />         ← pagination indicators
```

### Files

```
src/
  components/
    Slider/
      Slider.tsx           ← orchestrator, holds activeIndex state
      SliderCard.tsx       ← individual card (expanded / collapsed)
      SliderDots.tsx       ← dot indicators
      useSlider.ts         ← logic hook (auto-play, touch, keyboard)
      slider.map.ts      ← shared TypeScript interfaces
      Slider.module.css    ← or tailwind classes
  data/
    sliderData.ts          ← card content (title, description, image)
```

---

## 2. Data Model

```ts
// slider.map.ts
export interface SliderItem {
  id: number;
  title: string;
  description: string;
  image: string;   // URL or import
  alt: string;
}

export interface SliderProps {
  items: SliderItem[];
  autoPlayInterval?: number;   // ms, 0 = disabled
  className?: string;
}
```

---

## 3. State & Logic — `useSlider.ts`

```ts
export function useSlider(itemCount: number, autoPlayInterval = 4000) {
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-play
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

  const goTo = (index: number) => {
    setActiveIndex(index);
    resetTimer();
  };
  const next = () => goTo((activeIndex + 1) % itemCount);
  const prev = () => goTo((activeIndex - 1 + itemCount) % itemCount);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex]);

  return { activeIndex, goTo, next, prev };
}
```

---

## 4. Width Distribution Strategy

The active card takes a larger share; collapsed cards share the remainder equally.

```ts
// Example: 3 cards, active gets 50%, others share 50%
const EXPANDED_FLEX = 3;   // flex-grow value
const COLLAPSED_FLEX = 1;

// In SliderCard.tsx
const flexValue = isActive ? EXPANDED_FLEX : COLLAPSED_FLEX;
style = {
{
  flex: flexValue, transition
:
  'flex 0.5s cubic-bezier(0.4,0,0.2,1)'
}
}
```

> **Why `flex` instead of `width`?** Animating `flex-grow` with CSS transitions gives a smooth, proportional resize
> without hard-coding pixel values. Works across any container width — critical for responsiveness.

---

## 5. SliderCard Component

```tsx
interface SliderCardProps {
  item: SliderItem;
  isActive: boolean;
  onClick: () => void;
}

export const SliderCard: React.FC<SliderCardProps> = ({ item, isActive, onClick }) => (
  <article
    role="button"
    tabIndex={0}
    aria-expanded={isActive}
    aria-label={item.title}
    onClick={onClick}
    onKeyDown={e => e.key === 'Enter' && onClick()}
    style={{ flex: isActive ? 3 : 1, transition: 'flex 0.5s cubic-bezier(0.4,0,0.2,1)' }}
    className={`slider-card ${isActive ? 'slider-card--active' : ''}`}
  >
    <img src={item.image} alt={item.alt} className="slider-card__image"/>

    {/* Content fades in only when active */}
    <div className={`slider-card__content ${isActive ? 'slider-card__content--visible' : ''}`}>
      <h2 className="slider-card__title">{item.title}</h2>
      <p className="slider-card__description">{item.description}</p>
    </div>
  </article>
);
```

**Content fade-in CSS:**

```css
.slider-card__content {
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.3s ease 0.2s, transform 0.3s ease 0.2s;
    pointer-events: none;
}

.slider-card__content--visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
}
```

> The `0.2s` delay lets the card expand first, then text fades in — preventing a jarring flash.

---

## 6. Touch / Swipe Support (built into the hook)

```ts
// Append to useSlider.ts
function useSwipe(next: () => void, prev: () => void, ref: React.RefObject<HTMLElement>) {
  const startX = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX;
    };
    const onEnd = (e: TouchEvent) => {
      const delta = startX.current - e.changedTouches[0].clientX;
      if (Math.abs(delta) > 40) delta > 0 ? next() : prev();   // 40px threshold
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [next, prev, ref]);
}
```

---

## 7. Accessibility Checklist

| Requirement          | Implementation                                                       |
|----------------------|----------------------------------------------------------------------|
| Keyboard navigation  | `ArrowLeft` / `ArrowRight` in hook                                   |
| Screen reader labels | `aria-expanded`, `aria-label`, `role="button"` on cards              |
| Focus management     | `tabIndex={0}` on each card, visible `:focus-visible` ring           |
| Reduced motion       | `@media (prefers-reduced-motion: reduce)` — set transitions to `0ms` |
| Auto-play pause      | Pause `setInterval` on `focus` / `mouseenter`, resume on blur/leave  |

---

---

## 8. 📱 Mobile Optimisation (Priority — 90% of Users)

> Mobile is the primary target. Every decision below prioritises touch usability, performance on mid-range devices, and
> thumb-friendly interaction.

### 8.1 Layout — Vertical Stack on Mobile

On desktop: side-by-side cards with expanding widths.
On mobile (<640 px): **full-width vertical stack** — one card visible at a time, swiped horizontally like a standard
carousel.

```css
/* Desktop: horizontal flex with growing widths */
.slider-track {
    display: flex;
    flex-direction: row;
}

/* Mobile: snap scroll carousel — no JS animation needed */
@media (max-width: 639px) {
    .slider-track {
        flex-direction: row; /* keep row… */
        overflow-x: scroll;
        scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none; /* hide scrollbar */
        gap: 0;
    }

    .slider-card {
        flex: 0 0 100%; /* each card = full viewport width */
        scroll-snap-align: start;
    }

    /* Content always visible on mobile — no hover/expand */
    .slider-card__content {
        opacity: 1;
        transform: none;
    }
}
```

**Why native scroll snap over JS?**

- Zero JS animation on the critical path.
- Browser-native momentum scrolling.
- No layout thrashing; GPU composited.
- Respects user's system scroll physics.

---

### 8.2 Sync JS State with Native Scroll

When the user scrolls natively, sync `activeIndex` back to React state so dots stay in sync:

```ts
useEffect(() => {
  const el = trackRef.current;
  if (!el) return;

  const onScroll = () => {
    const index = Math.round(el.scrollLeft / el.offsetWidth);
    setActiveIndex(index);
  };

  el.addEventListener('scroll', onScroll, { passive: true });
  return () => el.removeEventListener('scroll', onScroll);
}, []);
```

When `activeIndex` changes programmatically (dot tap, auto-play):

```ts
trackRef.current?.scrollTo({ left: activeIndex * trackRef.current.offsetWidth, behavior: 'smooth' });
```

---

### 8.3 Touch Target Sizes

- Dots: minimum **44×44 px** tap target (padding around a smaller visual dot).
- Cards: full-width tap surface — no small hit areas.
- Prev/Next buttons (optional): min `48px` height, placed at thumb-reachable zones (bottom of card).

```css
.slider-dot {
    padding: 10px; /* enlarges tap target invisibly */
    cursor: pointer;
}

.slider-dot-inner {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
}
```

---

### 8.4 Performance

| Concern             | Solution                                                                |
|---------------------|-------------------------------------------------------------------------|
| Image loading       | `loading="lazy"` on cards 1+; `fetchpriority="high"` on card 0          |
| Image format        | Use `<picture>` with WebP + AVIF sources                                |
| Avoid layout shifts | Set explicit `aspect-ratio: 16/9` on image containers                   |
| Animation cost      | Only animate `flex-grow`, `opacity`, `transform` — all GPU-compositable |
| Reduce motion       | Disable all transitions for `prefers-reduced-motion` users              |
| Bundle size         | Component is pure React + CSS — zero extra runtime deps                 |

```tsx
<picture>
  <source srcSet={item.imageAvif} type="image/avif"/>
  <source srcSet={item.imageWebp} type="image/webp"/>
  <img
    src={item.image}
    alt={item.alt}
    loading={index === 0 ? 'eager' : 'lazy'}
    fetchpriority={index === 0 ? 'high' : 'auto'}
    decoding="async"
    style={{ aspectRatio: '16/9', width: '100%', objectFit: 'cover' }}
  />
</picture>
```

---

### 8.5 Auto-play — Mobile Considerations

- **Pause when tab is hidden**: use `document.addEventListener('visibilitychange', ...)`.
- **Pause when user touches**: on `touchstart`, clear interval; restart after `touchend` + 1.5s debounce.
- **Disable on `prefers-reduced-motion`**: check `window.matchMedia('(prefers-reduced-motion: reduce)')` before starting
  auto-play.

---

### 8.6 Font & Readability on Small Screens

```css
.slider-card__title {
    font-size: clamp(1.25rem, 4vw, 2rem); /* scales with viewport */
    line-height: 1.2;
}

.slider-card__description {
    font-size: clamp(0.875rem, 3vw, 1rem);
    line-height: 1.6;
}
```

---

### 8.7 Summary — Mobile Decision Matrix

| Feature            | Mobile                                                | Desktop              |
|--------------------|-------------------------------------------------------|----------------------|
| Layout             | Full-width, scroll snap                               | Flex expand/collapse |
| Animation engine   | Native CSS scroll                                     | JS-driven flex-grow  |
| Swipe              | Native scroll momentum                                | JS touch handler     |
| Content visibility | Always visible                                        | Fade in on expand    |
| Auto-play          | Disabled on `prefers-reduced-motion`, paused on touch | Enabled              |
| Image loading      | Lazy (except first)                                   | Lazy (except first)  |

---

## 9. Implementation Order (Recommended)

1. **Types & data** — `slider.map.ts`, `sliderData.ts`
2. **Hook** — `useSlider.ts` (state, keyboard, auto-play)
3. **SliderCard** — static markup + CSS transitions
4. **Slider (desktop)** — flex expand layout wired to hook
5. **Mobile CSS** — scroll-snap override, always-visible content
6. **Scroll sync** — bidirectional state ↔ native scroll
7. **Dots** — tap to jump, visual sync
8. **Accessibility pass** — ARIA, focus, reduced-motion
9. **Performance pass** — image optimisation, Lighthouse audit

---

## 10. Testing Checklist

- [ ] Clicking each card expands it on desktop
- [ ] Swipe left/right navigates on mobile
- [ ] Dots update correctly on native scroll
- [ ] Keyboard ArrowLeft/Right works
- [ ] Auto-play pauses on interaction, resumes after delay
- [ ] `prefers-reduced-motion` disables all animations
- [ ] No layout shift on image load (CLS = 0)
- [ ] Tap targets ≥ 44px on mobile
- [ ] Works on iOS Safari 15+, Chrome Android, Samsung Internet