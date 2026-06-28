/**
 * View layer — store dependency injection.
 *
 * Exposes the Model layer's BattleStore to the React tree via context, so
 * components reach it with `useBattleStore()` instead of prop-drilling.
 */

import { createContext, useContext } from 'react';
import type { BattleStore } from '@/model/battle-store';

export const BattleStoreContext = createContext<BattleStore | null>(null);

export const useBattleStore = (): BattleStore => {
  const store = useContext(BattleStoreContext);
  if (!store) {
    throw new Error('useBattleStore must be used within a BattleStoreContext provider');
  }
  return store;
};
