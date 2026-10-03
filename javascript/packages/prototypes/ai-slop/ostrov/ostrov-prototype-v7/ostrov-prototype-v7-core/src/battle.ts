import { Army } from "./army";
import type { Random } from "./random";
import type { EnemyKind } from "./unit-kind";

type BattleResult = {
  won: boolean;
  rounds: number;
  losses: number;
  slain: number;
};

const swing = 0.4;

class Battle {
  readonly army: Army;
  readonly enemies: readonly EnemyKind[];

  constructor(army: Army, enemies: readonly EnemyKind[]) {
    this.army = army;
    this.enemies = enemies;
  }

  get threat(): number {
    return this.enemies.reduce((total, enemy) => {
      return total + enemy.attack + enemy.health;
    }, 0);
  }

  resolve(random: Random): BattleResult {
    let ours = this.army.power.value;
    let theirs = this.threat;
    let rounds = 0;
    let slain = 0;

    while (ours > 0 && theirs > 0 && rounds < 20) {
      const luck = 1 - swing + random() * swing * 2;
      const hit = Math.max(1, Math.round(ours * 0.35 * luck));
      const bite = Math.max(1, Math.round(theirs * 0.3 * (2 - luck)));

      theirs -= hit;
      ours -= bite;
      rounds += 1;
      slain += hit;
    }

    const won = ours > 0;
    const spent = this.army.power.value - Math.max(0, ours);
    const share = this.army.power.value > 0 ? spent / this.army.power.value : 0;
    const losses = this.army.lose(Math.round(this.army.size.value * share));

    return {
      won,
      rounds,
      losses,
      slain,
    };
  }
}

export { Battle };
export type { BattleResult };
