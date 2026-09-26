import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { TFlight } from "../../store/ui-state";

/** How high the bezier arcs, as a share of the distance it covers. */
const ARC_LIFT_RATIO = 0.45;
const ARC_LIFT_MAX_PX = 170;

/** The spec asks for a bezier, so the mote follows a real quadratic curve. */
const flightPath = (flight: TFlight) => {
  const distance = Math.hypot(flight.toX - flight.fromX, flight.toY - flight.fromY);
  const lift = Math.min(ARC_LIFT_MAX_PX, distance * ARC_LIFT_RATIO);
  const controlX = (flight.fromX + flight.toX) / 2;
  const controlY = Math.min(flight.fromY, flight.toY) - lift;

  return `path("M ${flight.fromX.toFixed(1)} ${flight.fromY.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${flight.toX.toFixed(1)} ${flight.toY.toFixed(1)}")`;
};

const flightLabel = (flight: TFlight) => {
  if (flight.kind === "toxicity") {
    return `${flight.emoji} +${flight.amount}%`;
  }

  return `${flight.emoji} +${flight.amount}`;
};

/** The resources and toxicity flying from the buildings to the HUD. */
const FlightsLayer = () => {
  useSignals();
  const store = useStore();
  const flights = store.ui.flights.value;

  if (flights.length === 0) {
    return null;
  }

  return (
    <div className="flights-layer">
      {flights.map((flight) => (
        <span
          className={`flight flight--${flight.kind}`}
          key={flight.id}
          style={{ offsetPath: flightPath(flight), animationDelay: `${flight.delayMs}ms` }}
        >
          {flightLabel(flight)}
        </span>
      ))}
    </div>
  );
};

export { FlightsLayer };
