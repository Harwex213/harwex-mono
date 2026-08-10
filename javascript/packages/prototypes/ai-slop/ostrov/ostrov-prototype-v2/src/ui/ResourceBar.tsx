import { effect } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import type { ResourceKind } from "../economy/stock";
import { RESOURCE_KINDS } from "../economy/stock";
import { armyLimit } from "../state/army";
import { resourceLabel, stock } from "../state/resources";
import { armyUsed } from "../state/units";
import { ArmyIcon, ResourceIcon } from "./glyphs";

/**
 * The treasury, across the top of the screen.
 *
 * Deliberately large: this is the number the player is playing against, and it
 * is read from across the room while the island is being looked at, not
 * inspected. Every count sits on the same icon the build panel prices things
 * with, so a green number up here and a green cost down there are the same
 * resource.
 *
 * A credit is announced twice — the count itself takes a short beat, and the
 * amount floats off it — because a parcel lands every second or so and one of
 * the two would be missed while the player is looking at the map.
 */

/** One arrival, kept only long enough for the animation to be restarted by it. */
type Pulse = {
  amount: number;
  /** Ascending. Used as a React key, which is what replays the animation. */
  seq: number;
};

type Pulses = Partial<Record<ResourceKind, Pulse>>;

function ResourceBar(): React.JSX.Element {
  useSignals();
  const held = stock.value;
  const [pulses, setPulses] = useState<Pulses>({});
  const previous = useRef(stock.peek());
  const sequence = useRef(0);

  useEffect(() => {
    // Watching the signal here rather than diffing in the body: a render can be
    // repeated for reasons of React's own, and an arrival must be announced once.
    return effect(() => {
      const next = stock.value;
      const before = previous.current;
      previous.current = next;
      const raised: Pulses = {};
      let any = false;
      for (const kind of RESOURCE_KINDS) {
        const delta = next[kind] - before[kind];
        if (delta <= 0) {
          continue;
        }
        sequence.current += 1;
        raised[kind] = { amount: delta, seq: sequence.current };
        any = true;
      }
      if (any) {
        setPulses((current) => ({ ...current, ...raised }));
      }
    });
  }, []);

  return (
    <div className="resource-bar" aria-label="Запасы">
      {RESOURCE_KINDS.map((kind) => {
        const pulse = pulses[kind];
        return (
          <div className="res" key={kind}>
            <ResourceIcon kind={kind} className="res-icon" />
            <span className="res-text">
              <span className="res-name">{resourceLabel(kind)}</span>
              <span className="res-value" key={pulse?.seq ?? 0}>
                {held[kind]}
              </span>
            </span>
            {pulse ? (
              <span className="res-delta" key={pulse.seq}>
                +{pulse.amount}
              </span>
            ) : null}
          </div>
        );
      })}
      {/* The army sits with the treasury because it is spent the same way: a
          number the player plays against, and the one the barracks refuses on.
          It is a limit rather than a pile, so it reads `have / room`. */}
      <div className="res res-army" data-full={armyUsed.value >= armyLimit.value}>
        <ArmyIcon className="res-icon" />
        <span className="res-text">
          <span className="res-name">Армия</span>
          <span className="res-value" key={armyUsed.value}>
            {armyUsed.value}
            <span className="res-limit">/{armyLimit.value}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

export { ResourceBar };
