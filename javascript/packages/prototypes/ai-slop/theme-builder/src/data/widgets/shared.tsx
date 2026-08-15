import type { ReactNode } from "react";
import type { PropValue, WidgetProps } from "../../types";

interface SampleEvent {
  league: string;
  sport: string;
  home: string;
  away: string;
  kickoff: string;
  minute: string;
  score: string;
  odds: [number, number, number];
}

const SPORTS: string[] = [
  "Football",
  "Basketball",
  "Tennis",
  "Ice Hockey",
  "Esports",
  "MMA",
  "Cricket",
  "Baseball",
  "Boxing",
  "Volleyball",
  "Golf",
  "Darts",
];

const EVENTS: SampleEvent[] = [
  {
    league: "Premier League",
    sport: "Football",
    home: "Arsenal",
    away: "Chelsea",
    kickoff: "Today 20:45",
    minute: "63'",
    score: "2 : 1",
    odds: [1.94, 3.6, 4.2],
  },
  {
    league: "La Liga",
    sport: "Football",
    home: "Sevilla",
    away: "Valencia",
    kickoff: "Today 21:00",
    minute: "38'",
    score: "0 : 0",
    odds: [2.15, 3.25, 3.4],
  },
  {
    league: "NBA",
    sport: "Basketball",
    home: "Denver Nuggets",
    away: "Miami Heat",
    kickoff: "Tomorrow 02:30",
    minute: "Q3 04:12",
    score: "88 : 81",
    odds: [1.62, 12.0, 2.35],
  },
  {
    league: "ATP Masters",
    sport: "Tennis",
    home: "N. Djokovic",
    away: "C. Alcaraz",
    kickoff: "Today 18:15",
    minute: "Set 2",
    score: "1 : 0",
    odds: [1.78, 0, 2.05],
  },
  {
    league: "Serie A",
    sport: "Football",
    home: "Inter",
    away: "Napoli",
    kickoff: "Sat 19:00",
    minute: "71'",
    score: "1 : 1",
    odds: [2.4, 3.1, 3.05],
  },
  {
    league: "NHL",
    sport: "Ice Hockey",
    home: "Boston Bruins",
    away: "Toronto Maple Leafs",
    kickoff: "Today 23:00",
    minute: "P2 11:40",
    score: "3 : 2",
    odds: [1.85, 4.1, 3.5],
  },
  {
    league: "CS2 Major",
    sport: "Esports",
    home: "NaVi",
    away: "FaZe Clan",
    kickoff: "Today 17:30",
    minute: "Map 2",
    score: "1 : 0",
    odds: [1.55, 0, 2.45],
  },
  {
    league: "Bundesliga",
    sport: "Football",
    home: "Bayern",
    away: "Leipzig",
    kickoff: "Sun 17:30",
    minute: "22'",
    score: "1 : 0",
    odds: [1.44, 4.8, 6.5],
  },
];

const CASINO_GAMES: string[] = [
  "Lightning Roulette",
  "Sweet Bonanza",
  "Crazy Time",
  "Gates of Olympus",
  "Book of Dead",
  "Blackjack VIP",
  "Mega Ball",
  "Big Bass Splash",
];

const PAYMENTS: string[] = ["Visa", "Mastercard", "Apple Pay", "Skrill", "Neteller", "Bitcoin", "PayPal", "Trustly"];

/** Sample rows are picked by modulo so the same widget always renders the same data. */
function sample<T>(list: T[], count: number, offset = 0): T[] {
  const rows: T[] = [];

  for (let index = 0; index < count; index += 1) {
    rows.push(list[(index + offset) % list.length]);
  }

  return rows;
}

function str(props: WidgetProps, key: string, fallback = ""): string {
  const value: PropValue | undefined = props[key];

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function num(props: WidgetProps, key: string, fallback = 0): number {
  const value: PropValue | undefined = props[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);

  if (Number.isFinite(parsed) && value !== "" && value !== undefined) {
    return parsed;
  }

  return fallback;
}

function bool(props: WidgetProps, key: string, fallback = false): boolean {
  const value: PropValue | undefined = props[key];

  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function list(props: WidgetProps, key: string, fallback: string[] = []): string[] {
  const raw = str(props, key);

  if (raw.trim() === "") {
    return fallback;
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function fractional(decimal: number): string {
  const target = decimal - 1;
  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (let denominator = 1; denominator <= 20; denominator += 1) {
    const numerator = Math.round(target * denominator);
    const error = Math.abs(target - numerator / denominator);

    if (numerator > 0 && error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }

  return `${bestNumerator}/${bestDenominator}`;
}

function formatOdds(decimal: number, format: string): string {
  if (decimal <= 1) {
    return "—";
  }

  if (format === "fractional") {
    return fractional(decimal);
  }

  if (format === "american") {
    if (decimal >= 2) {
      return `+${Math.round((decimal - 1) * 100)}`;
    }

    return `${Math.round(-100 / (decimal - 1))}`;
  }

  return decimal.toFixed(2);
}

function money(amount: number, currency: string): string {
  return `${currency}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

interface OddsButtonProps {
  label: string;
  value: string;
  boosted?: boolean;
}

function OddsButton({ label, value, boosted = false }: OddsButtonProps): ReactNode {
  return (
    <span className={boosted ? "sb-odds sb-odds--boosted" : "sb-odds"}>
      <span className="sb-odds__label">{label}</span>
      <span className="sb-odds__value">{value}</span>
    </span>
  );
}

interface BlockHeadProps {
  title: string;
  action?: string;
  icon?: string;
}

function BlockHead({ title, action, icon }: BlockHeadProps): ReactNode {
  return (
    <div className="sb-block__head">
      <span className="sb-block__title">
        {icon ? <span className="sb-block__icon">{icon}</span> : null}
        {title}
      </span>
      {action ? <span className="sb-block__action">{action}</span> : null}
    </div>
  );
}

export type { SampleEvent };
export {
  BlockHead,
  bool,
  CASINO_GAMES,
  EVENTS,
  formatOdds,
  list,
  money,
  num,
  OddsButton,
  PAYMENTS,
  sample,
  SPORTS,
  str,
};
