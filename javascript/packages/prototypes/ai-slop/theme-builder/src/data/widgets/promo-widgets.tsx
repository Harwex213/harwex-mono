import type { WidgetDefinition } from "../../types";
import { BlockHead, bool, CASINO_GAMES, list, money, num, sample, str } from "./shared";

const heroBanner: WidgetDefinition = {
  type: "hero-banner",
  name: "Hero banner",
  category: "promo",
  glyph: "★",
  description: "Headline offer with background treatment and CTA.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "subtitle", label: "Subtitle", type: "textarea" },
    { key: "ctaLabel", label: "Button", type: "text" },
    { key: "secondaryLabel", label: "Secondary button", type: "text" },
    {
      key: "background",
      label: "Background",
      type: "select",
      options: [
        { value: "brand", label: "Brand gradient" },
        { value: "night", label: "Night stadium" },
        { value: "accent", label: "Accent gradient" },
        { value: "mesh", label: "Mesh" },
      ],
    },
    {
      key: "align",
      label: "Align",
      type: "select",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
      ],
    },
    { key: "height", label: "Height", type: "range", min: 140, max: 420, step: 10 },
    { key: "showBadge", label: "Offer badge", type: "boolean" },
  ],
  defaults: {
    title: "Bet €10, get €30 in free bets",
    subtitle: "New customers only. Free bets credited within 24 hours of settlement.",
    ctaLabel: "Join now",
    secondaryLabel: "How it works",
    background: "brand",
    align: "left",
    height: 260,
    showBadge: true,
  },
  render: (props) => (
    <div
      className={`sb-hero sb-hero--${str(props, "background", "brand")} sb-hero--${str(props, "align", "left")}`}
      style={{ minHeight: `${num(props, "height", 260)}px` }}
    >
      {bool(props, "showBadge") ? <span className="sb-hero__badge">Welcome offer</span> : null}
      <h1 className="sb-hero__title">{str(props, "title")}</h1>
      <p className="sb-hero__subtitle">{str(props, "subtitle")}</p>
      <div className="sb-hero__actions">
        <span className="sb-btn sb-btn--brand">{str(props, "ctaLabel")}</span>
        {str(props, "secondaryLabel") !== "" ? (
          <span className="sb-btn sb-btn--ghost">{str(props, "secondaryLabel")}</span>
        ) : null}
      </div>
    </div>
  ),
};

const promoStrip: WidgetDefinition = {
  type: "promo-strip",
  name: "Promo strip",
  category: "promo",
  glyph: "▬",
  description: "Thin scrolling row of short offer messages.",
  fields: [
    { key: "items", label: "Messages", type: "text", hint: "Comma separated" },
    {
      key: "tone",
      label: "Tone",
      type: "select",
      options: [
        { value: "accent", label: "Accent" },
        { value: "brand", label: "Brand" },
        { value: "quiet", label: "Quiet" },
      ],
    },
    { key: "showArrows", label: "Arrows", type: "boolean" },
  ],
  defaults: {
    items: "Acca boost up to 70%, Cash out on 20k events, Best odds guaranteed, 0% margin Sundays",
    tone: "accent",
    showArrows: true,
  },
  render: (props) => (
    <div className={`sb-strip sb-strip--${str(props, "tone", "accent")}`}>
      {bool(props, "showArrows") ? <span className="sb-strip__arrow">‹</span> : null}
      <div className="sb-strip__items">
        {list(props, "items").map((item) => (
          <span key={item} className="sb-strip__item">
            {item}
          </span>
        ))}
      </div>
      {bool(props, "showArrows") ? <span className="sb-strip__arrow">›</span> : null}
    </div>
  ),
};

const promotionsGrid: WidgetDefinition = {
  type: "promotions-grid",
  name: "Promotions grid",
  category: "promo",
  glyph: "▩",
  description: "Cards for every running offer.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "cards", label: "Cards", type: "range", min: 2, max: 8, step: 1 },
    { key: "columns", label: "Columns", type: "range", min: 1, max: 4, step: 1 },
    { key: "showTerms", label: "Terms link", type: "boolean" },
  ],
  defaults: {
    title: "Promotions",
    cards: 4,
    columns: 2,
    showTerms: true,
  },
  render: (props) => {
    const offers = [
      { name: "Acca insurance", copy: "One leg lets you down? Stake back up to €25." },
      { name: "Free bet club", copy: "Stake €25 a week, get a €5 free bet every Monday." },
      { name: "Price boosts", copy: "Enhanced prices on a headline pick every day." },
      { name: "Casino spins", copy: "50 free spins on your first casino deposit." },
      { name: "Refer a friend", copy: "€20 for you, €20 for them." },
      { name: "In-play insurance", copy: "0-0 at half time? Stake returned." },
      { name: "Virtuals bonus", copy: "10% back on virtual football losses." },
      { name: "Loyalty tiers", copy: "Climb five tiers for faster withdrawals." },
    ];

    return (
      <div className="sb-block sb-promos">
        <BlockHead title={str(props, "title")} action="All offers" icon="🎁" />
        <div
          className="sb-promos__grid"
          style={{ gridTemplateColumns: `repeat(${num(props, "columns", 2)}, minmax(0, 1fr))` }}
        >
          {offers.slice(0, num(props, "cards", 4)).map((offer) => (
            <div key={offer.name} className="sb-promos__card">
              <div className="sb-promos__art" />
              <div className="sb-promos__name">{offer.name}</div>
              <div className="sb-promos__copy">{offer.copy}</div>
              <div className="sb-promos__foot">
                <span className="sb-btn sb-btn--ghost">Opt in</span>
                {bool(props, "showTerms") ? <span className="sb-promos__terms">T&amp;C</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

const jackpotTicker: WidgetDefinition = {
  type: "jackpot-ticker",
  name: "Jackpot ticker",
  category: "promo",
  glyph: "💰",
  description: "Rolling jackpot or pool total.",
  fields: [
    { key: "label", label: "Label", type: "text" },
    { key: "amount", label: "Amount", type: "number", step: 1000 },
    { key: "currency", label: "Currency", type: "text" },
    { key: "note", label: "Note", type: "text" },
  ],
  defaults: {
    label: "Football jackpot",
    amount: 1250000,
    currency: "€",
    note: "Predict 15 results · Draw Sunday 21:00",
  },
  render: (props) => (
    <div className="sb-jackpot">
      <div className="sb-jackpot__label">{str(props, "label")}</div>
      <div className="sb-jackpot__amount">{money(num(props, "amount", 1250000), str(props, "currency", "€"))}</div>
      <div className="sb-jackpot__note">{str(props, "note")}</div>
    </div>
  ),
};

const topWinners: WidgetDefinition = {
  type: "top-winners",
  name: "Top winners",
  category: "promo",
  glyph: "🏆",
  description: "Social proof feed of recent big payouts.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "rows", label: "Rows", type: "range", min: 2, max: 8, step: 1 },
    { key: "currency", label: "Currency", type: "text" },
    { key: "showOdds", label: "Show odds", type: "boolean" },
  ],
  defaults: {
    title: "Recent winners",
    rows: 4,
    currency: "€",
    showOdds: true,
  },
  render: (props) => {
    const winners = ["m***a91", "j***nk", "sport_kid", "b***y7", "lucky***", "acca_king", "t***z", "n***92"];
    const currency = str(props, "currency", "€");

    return (
      <div className="sb-block sb-winners">
        <BlockHead title={str(props, "title")} icon="🏆" />
        {winners.slice(0, num(props, "rows", 4)).map((name, index) => (
          <div key={name} className="sb-winners__row">
            <span className="sb-winners__avatar">{name.slice(0, 1).toUpperCase()}</span>
            <span className="sb-winners__name">{name}</span>
            {bool(props, "showOdds") ? <span className="sb-winners__odds">{(6 + index * 3.4).toFixed(2)}</span> : null}
            <span className="sb-winners__amount">{money(1240 - index * 155, currency)}</span>
          </div>
        ))}
      </div>
    );
  },
};

const virtualsGrid: WidgetDefinition = {
  type: "virtuals-grid",
  name: "Virtual sports",
  category: "promo",
  glyph: "🎮",
  description: "Tiles for virtual football, racing and more.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "tiles", label: "Tiles", type: "range", min: 2, max: 6, step: 1 },
    { key: "showNext", label: "Next race timer", type: "boolean" },
  ],
  defaults: {
    title: "Virtual sports",
    tiles: 4,
    showNext: true,
  },
  render: (props) => {
    const tiles = ["Virtual football", "Horse racing", "Greyhounds", "Speedway", "Motor racing", "Tennis"];

    return (
      <div className="sb-block sb-virtuals">
        <BlockHead title={str(props, "title")} action="Lobby" icon="🎮" />
        <div className="sb-virtuals__grid">
          {tiles.slice(0, num(props, "tiles", 4)).map((tile, index) => (
            <div key={tile} className="sb-virtuals__tile">
              <span className="sb-virtuals__name">{tile}</span>
              {bool(props, "showNext") ? <span className="sb-virtuals__next">Next in 0{index + 1}:30</span> : null}
            </div>
          ))}
        </div>
      </div>
    );
  },
};

const casinoRow: WidgetDefinition = {
  type: "casino-row",
  name: "Casino cross-sell",
  category: "promo",
  glyph: "🎰",
  description: "Row of casino game thumbnails inside the sportsbook.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "games", label: "Games", type: "range", min: 2, max: 8, step: 1 },
    { key: "showLive", label: "Live dealer badge", type: "boolean" },
  ],
  defaults: {
    title: "Popular casino games",
    games: 5,
    showLive: true,
  },
  render: (props) => (
    <div className="sb-block sb-casino">
      <BlockHead title={str(props, "title")} action="Casino lobby" icon="🎰" />
      <div className="sb-casino__row">
        {sample(CASINO_GAMES, num(props, "games", 5)).map((game, index) => (
          <div key={`${game}-${index}`} className="sb-casino__tile">
            <div className={`sb-casino__art sb-casino__art--${index % 4}`} />
            <div className="sb-casino__name">{game}</div>
            {bool(props, "showLive") && index % 3 === 0 ? <span className="sb-casino__live">LIVE</span> : null}
          </div>
        ))}
      </div>
    </div>
  ),
};

const PROMO_WIDGETS: WidgetDefinition[] = [
  heroBanner,
  promoStrip,
  promotionsGrid,
  jackpotTicker,
  topWinners,
  virtualsGrid,
  casinoRow,
];

export { PROMO_WIDGETS };
