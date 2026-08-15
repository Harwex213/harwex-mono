import type { WidgetDefinition } from "../../types";
import { bool, list, num, sample, SPORTS, str } from "./shared";

const siteHeader: WidgetDefinition = {
  type: "site-header",
  name: "Site header",
  category: "structure",
  glyph: "▤",
  description: "Brand, primary navigation, balance and account actions.",
  fields: [
    { key: "brand", label: "Brand", type: "text" },
    { key: "links", label: "Nav links", type: "text", hint: "Comma separated" },
    { key: "showSearch", label: "Search field", type: "boolean" },
    { key: "showBalance", label: "Balance chip", type: "boolean" },
    { key: "balance", label: "Balance", type: "text" },
    { key: "ctaLabel", label: "Primary action", type: "text" },
    {
      key: "variant",
      label: "Variant",
      type: "select",
      options: [
        { value: "solid", label: "Solid" },
        { value: "glass", label: "Glass" },
        { value: "line", label: "Underline" },
      ],
    },
  ],
  defaults: {
    brand: "APEXBET",
    links: "Sports, In-Play, Casino, Virtuals, Promotions",
    showSearch: true,
    showBalance: true,
    balance: "€ 1,240.50",
    ctaLabel: "Deposit",
    variant: "solid",
  },
  render: (props) => (
    <header className={`sb-header sb-header--${str(props, "variant", "solid")}`}>
      <span className="sb-header__brand">{str(props, "brand")}</span>
      <nav className="sb-header__nav">
        {list(props, "links").map((link, index) => (
          <span key={link} className={index === 0 ? "sb-header__link is-active" : "sb-header__link"}>
            {link}
          </span>
        ))}
      </nav>
      <div className="sb-header__side">
        {bool(props, "showSearch") ? <span className="sb-header__search">⌕ Search events</span> : null}
        {bool(props, "showBalance") ? <span className="sb-header__balance">{str(props, "balance")}</span> : null}
        <span className="sb-btn sb-btn--brand">{str(props, "ctaLabel")}</span>
      </div>
    </header>
  ),
};

const sportNav: WidgetDefinition = {
  type: "sport-nav",
  name: "Sports menu",
  category: "structure",
  glyph: "⚽",
  description: "Sport pills or an A–Z sidebar list with event counts.",
  fields: [
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: [
        { value: "pills", label: "Horizontal pills" },
        { value: "list", label: "Vertical list" },
      ],
    },
    { key: "count", label: "Sports shown", type: "range", min: 3, max: 12, step: 1 },
    { key: "activeIndex", label: "Active item", type: "range", min: 0, max: 11, step: 1 },
    { key: "showCounts", label: "Event counts", type: "boolean" },
  ],
  defaults: {
    mode: "pills",
    count: 8,
    activeIndex: 0,
    showCounts: true,
  },
  render: (props) => {
    const mode = str(props, "mode", "pills");
    const active = num(props, "activeIndex");

    return (
      <div className={`sb-sports sb-sports--${mode}`}>
        {sample(SPORTS, num(props, "count", 8)).map((sport, index) => (
          <span key={sport} className={index === active ? "sb-sports__item is-active" : "sb-sports__item"}>
            <span>{sport}</span>
            {bool(props, "showCounts") ? <span className="sb-sports__count">{124 - index * 9}</span> : null}
          </span>
        ))}
      </div>
    );
  },
};

const searchBar: WidgetDefinition = {
  type: "search-bar",
  name: "Search bar",
  category: "structure",
  glyph: "⌕",
  description: "Event search with quick suggestion chips.",
  fields: [
    { key: "placeholder", label: "Placeholder", type: "text" },
    { key: "suggestions", label: "Suggestions", type: "text", hint: "Comma separated" },
    { key: "wide", label: "Full width", type: "boolean" },
  ],
  defaults: {
    placeholder: "Search teams, leagues, players…",
    suggestions: "Arsenal, NBA finals, Djokovic, Bayern",
    wide: true,
  },
  render: (props) => (
    <div className={bool(props, "wide") ? "sb-search sb-search--wide" : "sb-search"}>
      <div className="sb-search__field">
        <span className="sb-search__icon">⌕</span>
        <span className="sb-search__placeholder">{str(props, "placeholder")}</span>
      </div>
      <div className="sb-search__chips">
        {list(props, "suggestions").map((item) => (
          <span key={item} className="sb-chip">
            {item}
          </span>
        ))}
      </div>
    </div>
  ),
};

const richText: WidgetDefinition = {
  type: "rich-text",
  name: "Rich text",
  category: "structure",
  glyph: "¶",
  description: "SEO copy, terms or any long-form block.",
  fields: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "body", label: "Body", type: "textarea" },
    {
      key: "align",
      label: "Align",
      type: "select",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
      ],
    },
    { key: "size", label: "Heading size", type: "range", min: 14, max: 40, step: 1 },
  ],
  defaults: {
    heading: "Bet on more than 40 sports",
    body:
      "Live odds on 30,000 monthly events, cash out on selected markets and a bet builder for every major league. Licensed and regulated.",
    align: "left",
    size: 24,
  },
  render: (props) => (
    <div className="sb-rich" style={{ textAlign: str(props, "align", "left") as "left" | "center" }}>
      <h2 className="sb-rich__heading" style={{ fontSize: `${num(props, "size", 24)}px` }}>
        {str(props, "heading")}
      </h2>
      <p className="sb-rich__body">{str(props, "body")}</p>
    </div>
  ),
};

const ctaBanner: WidgetDefinition = {
  type: "cta-banner",
  name: "CTA banner",
  category: "structure",
  glyph: "◈",
  description: "Single call to action strip with optional small print.",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "ctaLabel", label: "Button", type: "text" },
    { key: "note", label: "Small print", type: "text" },
    {
      key: "tone",
      label: "Tone",
      type: "select",
      options: [
        { value: "brand", label: "Brand" },
        { value: "accent", label: "Accent" },
        { value: "quiet", label: "Quiet" },
      ],
    },
  ],
  defaults: {
    title: "Get €30 in free bets when you stake €10",
    ctaLabel: "Claim offer",
    note: "18+. New customers only. T&C apply.",
    tone: "brand",
  },
  render: (props) => (
    <div className={`sb-cta sb-cta--${str(props, "tone", "brand")}`}>
      <div>
        <div className="sb-cta__title">{str(props, "title")}</div>
        <div className="sb-cta__note">{str(props, "note")}</div>
      </div>
      <span className="sb-btn sb-btn--brand">{str(props, "ctaLabel")}</span>
    </div>
  ),
};

const mediaBlock: WidgetDefinition = {
  type: "media-block",
  name: "Media block",
  category: "structure",
  glyph: "▣",
  description: "Image or video placeholder with a caption.",
  fields: [
    { key: "caption", label: "Caption", type: "text" },
    { key: "ratio", label: "Aspect ratio", type: "range", min: 40, max: 120, step: 5, hint: "Height as % of width" },
    {
      key: "tone",
      label: "Tone",
      type: "select",
      options: [
        { value: "pitch", label: "Pitch green" },
        { value: "court", label: "Court blue" },
        { value: "night", label: "Night" },
      ],
    },
    { key: "showPlay", label: "Play button", type: "boolean" },
  ],
  defaults: {
    caption: "Matchday highlights",
    ratio: 60,
    tone: "pitch",
    showPlay: true,
  },
  render: (props) => (
    <figure className="sb-media">
      <div
        className={`sb-media__frame sb-media__frame--${str(props, "tone", "pitch")}`}
        style={{ paddingBottom: `${num(props, "ratio", 60)}%` }}
      >
        {bool(props, "showPlay") ? <span className="sb-media__play">▶</span> : null}
      </div>
      <figcaption className="sb-media__caption">{str(props, "caption")}</figcaption>
    </figure>
  ),
};

const siteFooter: WidgetDefinition = {
  type: "site-footer",
  name: "Site footer",
  category: "structure",
  glyph: "▥",
  description: "Link columns, licence line and payment badges.",
  fields: [
    { key: "columns", label: "Link columns", type: "range", min: 2, max: 5, step: 1 },
    { key: "licence", label: "Licence line", type: "text" },
    { key: "showPayments", label: "Payment badges", type: "boolean" },
    { key: "showAge", label: "18+ badge", type: "boolean" },
  ],
  defaults: {
    columns: 4,
    licence: "Licensed by the Malta Gaming Authority — MGA/B2C/394/2017",
    showPayments: true,
    showAge: true,
  },
  render: (props) => {
    const columns = [
      { title: "Sports", links: ["Football", "Tennis", "Basketball", "Esports"] },
      { title: "Betting", links: ["Bet builder", "Cash out", "Acca boost", "Live streaming"] },
      { title: "Help", links: ["Contact us", "Payment methods", "Betting rules", "FAQ"] },
      { title: "About", links: ["Affiliates", "Careers", "Responsible play", "Privacy"] },
      { title: "Casino", links: ["Slots", "Live casino", "Jackpots", "Table games"] },
    ].slice(0, num(props, "columns", 4));

    return (
      <footer className="sb-footer">
        <div className="sb-footer__cols">
          {columns.map((column) => (
            <div key={column.title} className="sb-footer__col">
              <div className="sb-footer__title">{column.title}</div>
              {column.links.map((link) => (
                <div key={link} className="sb-footer__link">
                  {link}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sb-footer__bar">
          {bool(props, "showAge") ? <span className="sb-footer__age">18+</span> : null}
          <span className="sb-footer__licence">{str(props, "licence")}</span>
          {bool(props, "showPayments") ? (
            <span className="sb-footer__pay">
              {["VISA", "MC", "SKRILL", "BTC"].map((item) => (
                <span key={item} className="sb-footer__badge">
                  {item}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </footer>
    );
  },
};

const STRUCTURE_WIDGETS: WidgetDefinition[] = [
  siteHeader,
  sportNav,
  searchBar,
  richText,
  ctaBanner,
  mediaBlock,
  siteFooter,
];

export { STRUCTURE_WIDGETS };
