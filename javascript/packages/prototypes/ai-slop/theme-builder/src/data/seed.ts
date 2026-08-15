import { createId } from "../ids";
import type {
  ContainerNode,
  PageNode,
  SectionLayoutId,
  SectionNode,
  SectionStyle,
  SiteDoc,
  WidgetNode,
  WidgetProps,
} from "../types";
import { DEFAULT_SECTION_STYLE } from "./layouts";
import { createWidget } from "./widget-registry";
import { DEFAULT_THEME } from "./theme";

function widget(type: string, overrides: WidgetProps = {}): WidgetNode {
  const node = createWidget(type);

  node.props = { ...node.props, ...overrides };

  return node;
}

function container(widgets: WidgetNode[]): ContainerNode {
  return {
    id: createId("c"),
    widgets,
  };
}

function section(
  name: string,
  layout: SectionLayoutId,
  columns: WidgetNode[][],
  style: Partial<SectionStyle> = {},
): SectionNode {
  return {
    id: createId("s"),
    name,
    layout,
    style: { ...DEFAULT_SECTION_STYLE, ...style },
    containers: columns.map((widgets) => container(widgets)),
  };
}

function page(name: string, path: string, sections: SectionNode[]): PageNode {
  return {
    id: createId("p"),
    name,
    path,
    sections,
  };
}

const flushStyle: Partial<SectionStyle> = {
  paddingY: 0,
  maxWidth: 0,
  background: "transparent",
};

const barStyle: Partial<SectionStyle> = {
  paddingY: 10,
  background: "surface",
};

function headerSection(): SectionNode {
  return section("Header", "single", [[widget("site-header")]], flushStyle);
}

function footerSection(): SectionNode {
  return section("Footer", "single", [[widget("site-footer")]], { ...flushStyle, background: "dark" });
}

function createSeedSite(): SiteDoc {
  return {
    name: "ApexBet Sportsbook",
    theme: { ...DEFAULT_THEME },
    pages: [
      page("Home", "/", [
        headerSection(),
        section("Sport menu", "single", [[widget("sport-nav", { mode: "pills", count: 9 })]], barStyle),
        section("Hero", "single", [[widget("hero-banner")]], { paddingY: 24 }),
        section("Offer strip", "single", [[widget("promo-strip")]], { paddingY: 8 }),
        section("Main coupon", "sidebar-right", [
          [widget("live-now"), widget("event-list", { title: "Football — Today", rows: 5 })],
          [widget("bet-slip"), widget("odds-boost")],
        ]),
        section("Casino cross-sell", "single", [[widget("casino-row")]], { background: "surface" }),
        section("Promotions", "single", [[widget("promotions-grid", { cards: 4, columns: 4 })]]),
        section("Trust", "thirds", [
          [widget("payments-strip", { count: 4 })],
          [widget("top-winners", { rows: 4 })],
          [widget("responsible-gaming")],
        ], { background: "surface" }),
        footerSection(),
      ]),
      page("In-Play", "/live", [
        headerSection(),
        section("Sport menu", "single", [[widget("sport-nav", { mode: "pills", count: 7, activeIndex: 1 })]], barStyle),
        section("Live board", "sidebar-right", [
          [
            widget("live-scoreboard"),
            widget("stream-player"),
            widget("event-list", { title: "In-play football", rows: 4, market: "totals" }),
          ],
          [widget("bet-slip", { mode: "single", legs: 1 }), widget("countdown")],
        ]),
        section("More live", "single", [[widget("live-now", { layout: "grid", cards: 4 })]], { background: "surface" }),
        footerSection(),
      ]),
      page("Sports", "/sports", [
        headerSection(),
        section("Search", "single", [[widget("search-bar")]], barStyle),
        section("Coupon", "sidebar-left", [
          [widget("sport-nav", { mode: "list", count: 10 })],
          [
            widget("event-list", { title: "Premier League", rows: 5 }),
            widget("event-list", { title: "La Liga", rows: 4, market: "handicap" }),
            widget("standings-table"),
          ],
        ]),
        footerSection(),
      ]),
      page("Promotions", "/promotions", [
        headerSection(),
        section("Hero", "single", [[
          widget("hero-banner", {
            title: "Offers for every matchday",
            subtitle: "Acca insurance, price boosts and a free bet club that never sleeps.",
            background: "accent",
            align: "center",
            height: 220,
          }),
        ]], { paddingY: 24 }),
        section("All offers", "single", [[widget("promotions-grid", { cards: 6, columns: 3 })]]),
        section("Join", "single", [[widget("cta-banner")]], { background: "brand" }),
        footerSection(),
      ]),
      page("My Bets", "/my-bets", [
        headerSection(),
        section("Bet history", "sidebar-right", [
          [widget("my-bets", { rows: 4 }), widget("results-list")],
          [widget("account-summary"), widget("bet-builder")],
        ]),
        footerSection(),
      ]),
      page("Account", "/account", [
        headerSection(),
        section("Sign up", "halves", [
          [widget("auth-form")],
          [widget("responsible-gaming"), widget("payments-strip", { count: 6 })],
        ], { paddingY: 40 }),
        footerSection(),
      ]),
    ],
  };
}

export { container, createSeedSite, page, section, widget };
