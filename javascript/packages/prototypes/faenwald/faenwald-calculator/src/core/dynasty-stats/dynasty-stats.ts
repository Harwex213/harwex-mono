type TDynastyStats = {
  /** incremented on each creation */
  id: number;

  /** > 0 */
  turn: number;

  /* event's id, which caused stats to be created */
  causeEvent: number;
};

export type { TDynastyStats };
