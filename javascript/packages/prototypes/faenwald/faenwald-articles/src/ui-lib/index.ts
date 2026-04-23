import { createElement, type ReactNode, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import './lib.css';

// ---- Scroll reveal ----

function useReveal(delay = 0) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const t = setTimeout(() => setVisible(true), delay);
          observer.disconnect();
          return () => clearTimeout(t);
        }
      },
      { threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return { ref, visible };
}

function revealClass(visible: boolean) {
  return clsx('lib-reveal', { 'lib-visible': visible });
}

// ---- Types ----

type Children = { children?: ReactNode };

// ---- Layout ----

export const Page = ({ children }: Children) =>
  createElement('div', { className: 'lib-page' }, children);

export const Section = ({ children }: Children) =>
  createElement('section', { className: 'lib-section' }, children);

export const TextSection = ({ children }: Children) =>
  createElement('div', { className: "lib-text-section" }, children);

export const Divider = () => {
  const { ref, visible } = useReveal();

  return createElement('div', { ref, className: clsx("lib-divider", revealClass(visible)) },
    createElement('div', { className: 'lib-divider__line' }),
    createElement('div', { className: 'lib-divider__diamond' }),
    createElement('div', { className: 'lib-divider__line' }),
  );
};

export const ImgWrapper = ({ children }: Children) =>
  createElement('div', { className: 'lib-img-wrapper' }, children);

// ---- Typography ----

export const Title = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('h1', { ref, className: clsx('lib-title', revealClass(visible)) }, children);
};

export const H2 = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('h2', { ref, className: clsx('lib-h2', revealClass(visible)) }, children);
};

export const H3 = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('h3', { ref, className: clsx('lib-h3', revealClass(visible)) }, children);
};

export const Label = ({ children }: Children) =>
  createElement('span', { className: 'lib-label' }, children);

export const Subtitle = ({ children }: Children) => {
  const { ref, visible } = useReveal(120);
  return createElement('p', { ref, className: clsx('lib-subtitle', revealClass(visible)) }, children);
};

export const Text = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('p', { ref, className: clsx('lib-text', revealClass(visible)) }, children);
};

export const Quote = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('blockquote', { ref, className: clsx('lib-quote', revealClass(visible)) }, children);
};

export const Mechanics = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('p', { ref, className: clsx('lib-mechanics', revealClass(visible)) }, children);
};

export const Callout = ({ children }: Children) => {
  const { ref, visible } = useReveal();
  return createElement('div', { ref, className: clsx('lib-callout', revealClass(visible)) }, children);
};

// ---- Images ----

export type ImgVariant = 'hero' | 'inline' | 'inline-left' | 'inline-right' | 'overlay';

type ImgProps = {
  className?: string;
  alt?: string;
  variant?: ImgVariant;
};

const figureClass: Record<ImgVariant, string> = {
  'hero': 'lib-img-hero',
  'inline': 'lib-img-inline',
  'inline-left': 'lib-img-inline lib-img-inline--left',
  'inline-right': 'lib-img-inline lib-img-inline--right',
  'overlay': 'lib-img-overlay',
};

export const Img = ({ className, variant = 'inline' }: ImgProps) => {
  const { ref, visible } = useReveal();

  return createElement('figure', { ref, className: clsx(className, figureClass[variant], revealClass(visible)) });
};

export const ImgOverlayContent = ({ children }: Children) =>
  createElement('div', { className: 'lib-img-overlay-content' }, children);
