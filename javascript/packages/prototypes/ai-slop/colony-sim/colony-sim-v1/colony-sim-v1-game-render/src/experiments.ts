// Render experiments, off by default: a flag here switches how the world is
// *drawn*, never what it is. Nothing behind one of these may reach the sim, so the
// same seed and the same turns give the same world with the flag either way — which
// is also why an experiment is not a command and not a signal. It is not state the
// world has, and it is not state the DOM HUD reads.
//
// The renderer learns the current value the same way it learns everything else:
// by looking, every frame. Reconciliation rather than subscriptions is this
// package's model (see CLAUDE.md), and a boolean read per frame is cheaper than the
// wiring a subscription would need — plus a flag that flips mid-frame can never
// leave half the view drawn under the old value.
//
// Who flips them is the app's business: dev-game puts a switch in its debug panel,
// the shipped game never touches the object and gets the defaults. An experiment
// that graduates loses its flag; one that fails takes its file with it.
interface Experiments {
  // Fog of war over the dead lands — see fog.ts.
  fogOfWar: boolean;
}

const experiments: Experiments = {
  fogOfWar: false,
};

function setExperiment<Flag extends keyof Experiments>(flag: Flag, value: Experiments[Flag]): void {
  experiments[flag] = value;
}

export type { Experiments };
export { experiments, setExperiment };
