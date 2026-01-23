import type { RefObject } from 'react';
import type { ScrollMode } from '../types';

export interface ScrollState {
  scrollTop: number;
  viewportHeight: number;
}

export interface ScrollObserver {
  getState: () => ScrollState;
  subscribe: (callback: () => void) => () => void;
}

/**
 * Creates a scroll observer for window or container scrolling
 * @param mode - 'window' or 'container'
 * @param containerRef - Reference to container element (required for 'container' mode)
 * @returns ScrollObserver object with getState and subscribe methods
 */
export function createScrollObserver(
  mode: ScrollMode,
  containerRef?: RefObject<HTMLElement>
): ScrollObserver {
  let rafId: number | null = null;
  const listeners = new Set<() => void>();

  const getState = (): ScrollState => {
    if (mode === 'window') {
      return {
        scrollTop: window.scrollY || document.documentElement.scrollTop,
        viewportHeight: window.innerHeight,
      };
    } else {
      const container = containerRef?.current;
      if (!container) {
        return { scrollTop: 0, viewportHeight: 0 };
      }
      return {
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight,
      };
    }
  };

  const notifyListeners = () => {
    rafId = null;
    listeners.forEach(listener => listener());
  };

  const scheduleUpdate = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(notifyListeners);
  };

  const handleScroll = () => {
    scheduleUpdate();
  };

  const subscribe = (callback: () => void): (() => void) => {
    listeners.add(callback);

    // Set up scroll listener on first subscription
    if (listeners.size === 1) {
      if (mode === 'window') {
        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleScroll, { passive: true });
      } else {
        const container = containerRef?.current;
        container?.addEventListener('scroll', handleScroll, { passive: true });
      }
    }

    // Return unsubscribe function
    return () => {
      listeners.delete(callback);

      // Clean up scroll listener when no more subscribers
      if (listeners.size === 0) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (mode === 'window') {
          window.removeEventListener('scroll', handleScroll);
          window.removeEventListener('resize', handleScroll);
        } else {
          const container = containerRef?.current;
          container?.removeEventListener('scroll', handleScroll);
        }
      }
    };
  };

  return {
    getState,
    subscribe,
  };
}
