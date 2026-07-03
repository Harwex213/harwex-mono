/**
 * API layer — battle endpoints.
 *
 * Domain-specific calls built on top of the generic `request` function. This is
 * the only surface the Model layer imports from the API layer.
 */

import { request } from './request';
import type { BattleDTO, ScenarioSummary } from './types';

export const battleApi = {
  /** The preset battles a viewer can pick between (showcase item 25). */
  listScenarios: (): Promise<ScenarioSummary[]> =>
    request<ScenarioSummary[]>({ url: '/scenarios', method: 'GET' }),

  /**
   * Load a battle. With no `scenarioId` the default (first) scenario is served,
   * preserving the original `GET /battle` behaviour; pass an id to load a
   * specific preset (showcase item 25).
   */
  loadBattle: (scenarioId?: string): Promise<BattleDTO> =>
    request<BattleDTO>({ url: scenarioId ? `/battle/${scenarioId}` : '/battle', method: 'GET' }),
};
