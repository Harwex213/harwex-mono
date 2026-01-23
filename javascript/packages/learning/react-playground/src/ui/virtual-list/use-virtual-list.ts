import { useContext } from 'react';
import { VirtualListContext } from './virtual-list-provider';
import type { VirtualListContextValue } from './types';

/**
 * Hook to access virtual list context
 * @throws Error if used outside of VirtualListProvider
 */
export function useVirtualList(): VirtualListContextValue {
  const context = useContext(VirtualListContext);
  
  if (!context) {
    throw new Error('useVirtualList must be used within a VirtualListProvider');
  }
  
  return context;
}
