import { useEffect, useRef, type ReactNode } from 'react';
import { useVirtualList } from './use-virtual-list';
import styles from './virtual-list.module.css';

export interface VirtualListRootProps {
  children: ReactNode;
}

export function VirtualListRoot({ children }: VirtualListRootProps) {
  const { totalHeight, setListOffsetTop } = useVirtualList();
  const rootRef = useRef<HTMLDivElement>(null);

  // Measure and track offset from scroll container top
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const updateOffset = () => {
      const rect = element.getBoundingClientRect();
      // For window scroll: offset is distance from top of page
      // For container scroll: offset would need adjustment based on container
      const offsetTop = rect.top + window.scrollY;
      setListOffsetTop(offsetTop);
    };

    // Initial measurement
    updateOffset();

    // Use IntersectionObserver for efficient tracking
    const observer = new IntersectionObserver(
      () => {
        updateOffset();
      },
      {
        threshold: [0, 1],
      }
    );

    observer.observe(element);

    // Also update on window resize
    window.addEventListener('resize', updateOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOffset);
    };
  }, [setListOffsetTop]);

  return (
    <div
      ref={rootRef}
      className={styles.virtualListRoot}
      style={{ height: `${totalHeight}px`, position: 'relative' }}
    >
      {children}
    </div>
  );
}
