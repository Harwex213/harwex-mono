// The UI sounds. One element per sound, built once at module load: a fresh
// element per click would re-decode the clip before its first frame, and the
// delay would land between the click and the sound answering it.
import unitClickUrl from "../../assets/sounds/unit click.mp3";

// Full volume is louder than this sound needs to be. It answers a click, and a
// click is the quietest thing the board reports.
const UNIT_SELECT_VOLUME = 0.5;

const unitSelect = new Audio(unitClickUrl);
unitSelect.preload = "auto";
unitSelect.volume = UNIT_SELECT_VOLUME;

// Answers a unit being selected. A selection made while the sound from the one
// before it is still playing restarts it instead of stacking a second voice on
// top: the two are the same clip, and stacking them only doubles the volume.
function playUnitSelect(): void {
  unitSelect.currentTime = 0;

  // A browser that has taken no gesture yet refuses to play, and says so with a
  // rejected promise. Every call here follows a click, so a refusal is the
  // browser's own business — dropped rather than left to surface as an unhandled
  // rejection.
  void unitSelect.play().catch(() => {});
}

export { playUnitSelect };
