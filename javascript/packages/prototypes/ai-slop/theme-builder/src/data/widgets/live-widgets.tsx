import type { WidgetDefinition } from "../../types";
import { BlockHead, bool, EVENTS, formatOdds, num, OddsButton, sample, str } from "./shared";

const liveNow: WidgetDefinition = {
  type: "live-now",
  name: "Live now",
  category: "live",
  glyph: "●",
  description: "Carousel of in-play events with a pulsing live badge.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "cards", label: "Cards", type: "range", min: 1, max: 6, step: 1 },
    {
      key: "layout",
      label: "Layout",
      type: "select",
      options: [
        { value: "carousel", label: "Carousel" },
        { value: "grid", label: "Grid" },
      ],
    },
    { key: "showStream", label: "Stream badge", type: "boolean" },
    { key: "showOdds", label: "Odds row", type: "boolean" },
  ],
  defaults: {
    title: "Live now",
    cards: 3,
    layout: "carousel",
    showStream: true,
    showOdds: true,
  },
  render: (props) => (
    <div className="sb-block sb-live">
      <BlockHead title={str(props, "title")} action="All in-play" icon="●" />
      <div className={`sb-live__track sb-live__track--${str(props, "layout", "carousel")}`}>
        {sample(EVENTS, num(props, "cards", 3)).map((event, index) => (
          <div key={`${event.home}-${index}`} className="sb-live__card">
            <div className="sb-live__top">
              <span className="sb-live__badge">LIVE {event.minute}</span>
              {bool(props, "showStream") ? <span className="sb-live__stream">▶ Stream</span> : null}
            </div>
            <div className="sb-live__league">{event.league}</div>
            <div className="sb-live__teams">
              <span>{event.home}</span>
              <span className="sb-live__score">{event.score}</span>
            </div>
            <div className="sb-live__teams">
              <span>{event.away}</span>
            </div>
            {bool(props, "showOdds") ? (
              <div className="sb-live__odds">
                {["1", "X", "2"].map((label, cell) => (
                  <OddsButton key={label} label={label} value={formatOdds(event.odds[cell] || 2.1, "decimal")} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  ),
};

const scoreboard: WidgetDefinition = {
  type: "live-scoreboard",
  name: "Scoreboard",
  category: "live",
  glyph: "🏟",
  description: "Hero scoreboard for the event currently being watched.",
  fields: [
    { key: "home", label: "Home", type: "text" },
    { key: "away", label: "Away", type: "text" },
    { key: "score", label: "Score", type: "text" },
    { key: "clock", label: "Clock", type: "text" },
    { key: "competition", label: "Competition", type: "text" },
    { key: "showMomentum", label: "Momentum bar", type: "boolean" },
    { key: "momentum", label: "Home momentum", type: "range", min: 0, max: 100, step: 1 },
  ],
  defaults: {
    home: "Arsenal",
    away: "Chelsea",
    score: "2 : 1",
    clock: "63'",
    competition: "Premier League · Emirates Stadium",
    showMomentum: true,
    momentum: 64,
  },
  render: (props) => (
    <div className="sb-score">
      <div className="sb-score__competition">{str(props, "competition")}</div>
      <div className="sb-score__main">
        <span className="sb-score__team">{str(props, "home")}</span>
        <span className="sb-score__value">{str(props, "score")}</span>
        <span className="sb-score__team sb-score__team--away">{str(props, "away")}</span>
      </div>
      <div className="sb-score__clock">{str(props, "clock")}</div>
      {bool(props, "showMomentum") ? (
        <div className="sb-score__momentum">
          <span style={{ width: `${num(props, "momentum", 64)}%` }} />
        </div>
      ) : null}
    </div>
  ),
};

const streamPlayer: WidgetDefinition = {
  type: "stream-player",
  name: "Live stream",
  category: "live",
  glyph: "▶",
  description: "Video player placeholder with match title bar.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "ratio", label: "Aspect ratio", type: "range", min: 40, max: 80, step: 1, hint: "Height as % of width" },
    { key: "showControls", label: "Controls", type: "boolean" },
    { key: "quality", label: "Quality chip", type: "text" },
  ],
  defaults: {
    title: "Arsenal v Chelsea — live",
    ratio: 56,
    showControls: true,
    quality: "HD",
  },
  render: (props) => (
    <div className="sb-stream">
      <div className="sb-stream__frame" style={{ paddingBottom: `${num(props, "ratio", 56)}%` }}>
        <span className="sb-stream__play">▶</span>
        <span className="sb-stream__quality">{str(props, "quality")}</span>
      </div>
      <div className="sb-stream__bar">
        <span>{str(props, "title")}</span>
        {bool(props, "showControls") ? <span className="sb-stream__controls">⏸ ⇱ ⚙</span> : null}
      </div>
    </div>
  ),
};

const countdown: WidgetDefinition = {
  type: "countdown",
  name: "Countdown",
  category: "live",
  glyph: "⏱",
  description: "Kick-off timer for a headline fixture.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "subtitle", label: "Subtitle", type: "text" },
    { key: "hours", label: "Hours", type: "number", min: 0, step: 1 },
    { key: "minutes", label: "Minutes", type: "number", min: 0, max: 59, step: 1 },
    { key: "seconds", label: "Seconds", type: "number", min: 0, max: 59, step: 1 },
  ],
  defaults: {
    title: "Champions League final",
    subtitle: "Real Madrid v Bayern · Sat 21:00",
    hours: 6,
    minutes: 42,
    seconds: 18,
  },
  render: (props) => (
    <div className="sb-countdown">
      <div className="sb-countdown__title">{str(props, "title")}</div>
      <div className="sb-countdown__subtitle">{str(props, "subtitle")}</div>
      <div className="sb-countdown__clock">
        {[
          { value: num(props, "hours", 6), label: "hrs" },
          { value: num(props, "minutes", 42), label: "min" },
          { value: num(props, "seconds", 18), label: "sec" },
        ].map((cell) => (
          <span key={cell.label} className="sb-countdown__cell">
            <span className="sb-countdown__num">{String(cell.value).padStart(2, "0")}</span>
            <span className="sb-countdown__unit">{cell.label}</span>
          </span>
        ))}
      </div>
    </div>
  ),
};

const LIVE_WIDGETS: WidgetDefinition[] = [liveNow, scoreboard, streamPlayer, countdown];

export { LIVE_WIDGETS };
