import type { PropField, WidgetDefinition } from "../../types";
import { BlockHead, bool, EVENTS, formatOdds, money, num, OddsButton, sample, str } from "./shared";

const oddsFormatField: PropField = {
  key: "oddsFormat",
  label: "Odds format",
  type: "select",
  options: [
    { value: "decimal", label: "Decimal" },
    { value: "fractional", label: "Fractional" },
    { value: "american", label: "American" },
  ],
};

const eventList: WidgetDefinition = {
  type: "event-list",
  name: "Event list",
  category: "betting",
  glyph: "≡",
  description: "Coupon of upcoming events with a market column set.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "rows", label: "Events", type: "range", min: 1, max: 8, step: 1 },
    {
      key: "market",
      label: "Market",
      type: "select",
      options: [
        { value: "1x2", label: "1 · X · 2" },
        { value: "totals", label: "Over / Under" },
        { value: "handicap", label: "Handicap" },
      ],
    },
    oddsFormatField,
    { key: "showLeague", label: "League row", type: "boolean" },
    { key: "showStats", label: "Stats link", type: "boolean" },
  ],
  defaults: {
    title: "Football — Today",
    rows: 4,
    market: "1x2",
    oddsFormat: "decimal",
    showLeague: true,
    showStats: true,
  },
  render: (props) => {
    const market = str(props, "market", "1x2");
    const format = str(props, "oddsFormat", "decimal");
    const labels = market === "totals" ? ["O 2.5", "U 2.5"] : market === "handicap" ? ["-1", "+1"] : ["1", "X", "2"];

    return (
      <div className="sb-block sb-events">
        <BlockHead title={str(props, "title")} action="All markets" icon="⚑" />
        {sample(EVENTS, num(props, "rows", 4)).map((event, index) => (
          <div key={`${event.home}-${index}`} className="sb-events__row">
            <div className="sb-events__info">
              {bool(props, "showLeague") ? <div className="sb-events__league">{event.league}</div> : null}
              <div className="sb-events__teams">
                <span>{event.home}</span>
                <span>{event.away}</span>
              </div>
              <div className="sb-events__meta">
                <span>{event.kickoff}</span>
                {bool(props, "showStats") ? <span className="sb-events__stats">Stats</span> : null}
              </div>
            </div>
            <div className="sb-events__odds">
              {labels.map((label, cell) => (
                <OddsButton
                  key={label}
                  label={label}
                  value={formatOdds(event.odds[cell % event.odds.length] || 1.9 + cell / 10, format)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
};

const betSlip: WidgetDefinition = {
  type: "bet-slip",
  name: "Bet slip",
  category: "betting",
  glyph: "🧾",
  description: "Single or accumulator slip with stake and returns.",
  fields: [
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: [
        { value: "single", label: "Single" },
        { value: "acca", label: "Accumulator" },
      ],
    },
    { key: "legs", label: "Selections", type: "range", min: 1, max: 6, step: 1 },
    { key: "stake", label: "Stake", type: "number", min: 1, step: 1 },
    { key: "currency", label: "Currency", type: "text" },
    { key: "showBoost", label: "Acca boost", type: "boolean" },
    { key: "showFreeBet", label: "Free bet toggle", type: "boolean" },
    oddsFormatField,
  ],
  defaults: {
    mode: "acca",
    legs: 3,
    stake: 20,
    currency: "€",
    showBoost: true,
    showFreeBet: true,
    oddsFormat: "decimal",
  },
  render: (props) => {
    const legs = sample(EVENTS, num(props, "legs", 3), 2);
    const stake = num(props, "stake", 20);
    const currency = str(props, "currency", "€");
    const format = str(props, "oddsFormat", "decimal");
    const total = legs.reduce((acc, event) => acc * event.odds[0], 1);
    const boosted = bool(props, "showBoost") ? total * 1.1 : total;

    return (
      <aside className="sb-block sb-slip">
        <BlockHead title={str(props, "mode") === "acca" ? "Accumulator" : "Bet slip"} action={`${legs.length}`} icon="🧾" />
        {legs.map((event, index) => (
          <div key={`${event.home}-${index}`} className="sb-slip__leg">
            <div>
              <div className="sb-slip__pick">{event.home} to win</div>
              <div className="sb-slip__match">
                {event.home} v {event.away}
              </div>
            </div>
            <span className="sb-slip__odds">{formatOdds(event.odds[0], format)}</span>
          </div>
        ))}
        {bool(props, "showBoost") ? <div className="sb-slip__boost">Acca boost +10% applied</div> : null}
        <div className="sb-slip__stake">
          <span>Stake</span>
          <span className="sb-slip__amount">{money(stake, currency)}</span>
        </div>
        <div className="sb-slip__stake">
          <span>Returns</span>
          <span className="sb-slip__amount sb-slip__amount--win">{money(stake * boosted, currency)}</span>
        </div>
        {bool(props, "showFreeBet") ? <div className="sb-slip__freebet">Use free bet (€10)</div> : null}
        <span className="sb-btn sb-btn--brand sb-btn--block">Place bet</span>
      </aside>
    );
  },
};

const betBuilder: WidgetDefinition = {
  type: "bet-builder",
  name: "Bet builder",
  category: "betting",
  glyph: "🛠",
  description: "Same-game legs combined into one price.",
  fields: [
    { key: "match", label: "Match", type: "text" },
    { key: "legs", label: "Legs", type: "range", min: 2, max: 5, step: 1 },
    { key: "price", label: "Combined price", type: "number", step: 0.01 },
    oddsFormatField,
  ],
  defaults: {
    match: "Arsenal v Chelsea",
    legs: 3,
    price: 14.5,
    oddsFormat: "decimal",
  },
  render: (props) => {
    const legs = [
      "Arsenal to win",
      "Over 2.5 goals",
      "B. Saka to score",
      "Both teams to score",
      "Over 9.5 corners",
    ].slice(0, num(props, "legs", 3));

    return (
      <div className="sb-block sb-builder">
        <BlockHead title="Bet builder" action={str(props, "match")} icon="🛠" />
        {legs.map((leg) => (
          <div key={leg} className="sb-builder__leg">
            <span className="sb-builder__tick">✓</span>
            <span>{leg}</span>
          </div>
        ))}
        <div className="sb-builder__foot">
          <span>Combined price</span>
          <span className="sb-builder__price">{formatOdds(num(props, "price", 14.5), str(props, "oddsFormat", "decimal"))}</span>
        </div>
      </div>
    );
  },
};

const oddsBoost: WidgetDefinition = {
  type: "odds-boost",
  name: "Boosted price",
  category: "betting",
  glyph: "⚡",
  description: "Featured selection with a struck-through old price.",
  fields: [
    { key: "pick", label: "Selection", type: "text" },
    { key: "match", label: "Match", type: "text" },
    { key: "was", label: "Was", type: "number", step: 0.01 },
    { key: "now", label: "Now", type: "number", step: 0.01 },
    oddsFormatField,
  ],
  defaults: {
    pick: "Haaland to score 2+",
    match: "Man City v Everton — Sat 17:30",
    was: 4.5,
    now: 6.0,
    oddsFormat: "decimal",
  },
  render: (props) => {
    const format = str(props, "oddsFormat", "decimal");

    return (
      <div className="sb-boost">
        <span className="sb-boost__flag">Price boost</span>
        <div className="sb-boost__pick">{str(props, "pick")}</div>
        <div className="sb-boost__match">{str(props, "match")}</div>
        <div className="sb-boost__prices">
          <span className="sb-boost__was">{formatOdds(num(props, "was", 4.5), format)}</span>
          <span className="sb-boost__arrow">→</span>
          <OddsButton label="Back" value={formatOdds(num(props, "now", 6), format)} boosted />
        </div>
      </div>
    );
  },
};

const myBets: WidgetDefinition = {
  type: "my-bets",
  name: "My bets",
  category: "betting",
  glyph: "🎟",
  description: "Open and settled bets with cash-out buttons.",
  fields: [
    { key: "rows", label: "Bets", type: "range", min: 1, max: 6, step: 1 },
    {
      key: "tab",
      label: "Active tab",
      type: "select",
      options: [
        { value: "open", label: "Open" },
        { value: "settled", label: "Settled" },
      ],
    },
    { key: "showCashout", label: "Cash out", type: "boolean" },
    { key: "currency", label: "Currency", type: "text" },
  ],
  defaults: {
    rows: 3,
    tab: "open",
    showCashout: true,
    currency: "€",
  },
  render: (props) => {
    const currency = str(props, "currency", "€");
    const isOpen = str(props, "tab", "open") === "open";

    return (
      <div className="sb-block sb-bets">
        <div className="sb-bets__tabs">
          <span className={isOpen ? "sb-bets__tab is-active" : "sb-bets__tab"}>Open</span>
          <span className={isOpen ? "sb-bets__tab" : "sb-bets__tab is-active"}>Settled</span>
        </div>
        {sample(EVENTS, num(props, "rows", 3), 1).map((event, index) => (
          <div key={`${event.home}-${index}`} className="sb-bets__row">
            <div>
              <div className="sb-bets__pick">{event.home} to win</div>
              <div className="sb-bets__match">
                {event.league} · {money(10 + index * 5, currency)} @ {event.odds[0].toFixed(2)}
              </div>
            </div>
            {isOpen && bool(props, "showCashout") ? (
              <span className="sb-btn sb-btn--ghost">Cash out {money(12.4 + index * 3, currency)}</span>
            ) : (
              <span className={index % 2 === 0 ? "sb-bets__result is-won" : "sb-bets__result is-lost"}>
                {index % 2 === 0 ? "Won" : "Lost"}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  },
};

const standings: WidgetDefinition = {
  type: "standings-table",
  name: "Standings",
  category: "betting",
  glyph: "▦",
  description: "League table used as statistics context.",
  fields: [
    { key: "league", label: "League", type: "text" },
    { key: "rows", label: "Teams", type: "range", min: 3, max: 10, step: 1 },
    { key: "highlight", label: "Highlight row", type: "range", min: 0, max: 9, step: 1 },
  ],
  defaults: {
    league: "Premier League",
    rows: 6,
    highlight: 0,
  },
  render: (props) => {
    const teams = ["Arsenal", "Man City", "Liverpool", "Aston Villa", "Tottenham", "Chelsea", "Newcastle", "Brighton", "West Ham", "Everton"];
    const rows = teams.slice(0, num(props, "rows", 6));
    const highlight = num(props, "highlight");

    return (
      <div className="sb-block sb-table">
        <BlockHead title={str(props, "league")} action="Full table" icon="▦" />
        <div className="sb-table__head">
          <span>#</span>
          <span>Team</span>
          <span>P</span>
          <span>GD</span>
          <span>Pts</span>
        </div>
        {rows.map((team, index) => (
          <div key={team} className={index === highlight ? "sb-table__row is-active" : "sb-table__row"}>
            <span>{index + 1}</span>
            <span>{team}</span>
            <span>{30 - index}</span>
            <span>{`+${42 - index * 5}`}</span>
            <span className="sb-table__pts">{72 - index * 4}</span>
          </div>
        ))}
      </div>
    );
  },
};

const results: WidgetDefinition = {
  type: "results-list",
  name: "Results",
  category: "betting",
  glyph: "✓",
  description: "Settled fixtures with final scores.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "rows", label: "Rows", type: "range", min: 2, max: 8, step: 1 },
    { key: "showDate", label: "Date column", type: "boolean" },
  ],
  defaults: {
    title: "Yesterday's results",
    rows: 4,
    showDate: true,
  },
  render: (props) => (
    <div className="sb-block sb-results">
      <BlockHead title={str(props, "title")} action="Archive" icon="✓" />
      {sample(EVENTS, num(props, "rows", 4), 3).map((event, index) => (
        <div key={`${event.home}-${index}`} className="sb-results__row">
          <span className="sb-results__team">{event.home}</span>
          <span className="sb-results__score">{event.score}</span>
          <span className="sb-results__team sb-results__team--away">{event.away}</span>
          {bool(props, "showDate") ? <span className="sb-results__date">FT</span> : null}
        </div>
      ))}
    </div>
  ),
};

const BETTING_WIDGETS: WidgetDefinition[] = [
  eventList,
  betSlip,
  betBuilder,
  oddsBoost,
  myBets,
  standings,
  results,
];

export { BETTING_WIDGETS };
