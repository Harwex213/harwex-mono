type SeatMeterProps = {
  readonly seats: number;
  readonly seatsTaken: number;
  readonly watching: number;
};

function SeatMeter({ seats, seatsTaken, watching }: SeatMeterProps) {
  const ratio = seats === 0 ? 0 : Math.min(1, seatsTaken / seats);
  const free = Math.max(0, seats - seatsTaken);
  const tone = free === 0 ? "full" : ratio > 0.75 ? "tight" : "open";
  return (
    <span className="lc-seats">
      <span className="lc-seats__row">
        <span>
          {seatsTaken} / {seats} seats
        </span>
        <span>{watching} watching</span>
      </span>
      <span className="lc-seats__track">
        <span
          className={tone === "open" ? "lc-seats__fill" : `lc-seats__fill lc-seats__fill--${tone}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
    </span>
  );
}

export { SeatMeter };
