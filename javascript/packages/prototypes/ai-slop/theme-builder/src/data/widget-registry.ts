import { createId } from "../ids";
import type { WidgetCategory, WidgetCategoryId, WidgetDefinition, WidgetNode } from "../types";
import { ACCOUNT_WIDGETS } from "./widgets/account-widgets";
import { BETTING_WIDGETS } from "./widgets/betting-widgets";
import { LIVE_WIDGETS } from "./widgets/live-widgets";
import { PROMO_WIDGETS } from "./widgets/promo-widgets";
import { STRUCTURE_WIDGETS } from "./widgets/structure-widgets";

const WIDGET_CATEGORIES: WidgetCategory[] = [
  { id: "structure", label: "Structure", hint: "Navigation, copy and page furniture" },
  { id: "betting", label: "Betting", hint: "Coupons, slips and bet history" },
  { id: "live", label: "In-play", hint: "Live scores, streams and timers" },
  { id: "promo", label: "Promotions", hint: "Offers, jackpots and cross-sell" },
  { id: "account", label: "Account", hint: "Auth, payments and safer gambling" },
];

const ALL_WIDGETS: WidgetDefinition[] = [
  ...STRUCTURE_WIDGETS,
  ...BETTING_WIDGETS,
  ...LIVE_WIDGETS,
  ...PROMO_WIDGETS,
  ...ACCOUNT_WIDGETS,
];

const WIDGETS_BY_TYPE = new Map<string, WidgetDefinition>(
  ALL_WIDGETS.map((definition) => [definition.type, definition]),
);

/** Renders instead of a widget whose type is missing, so a stale import still opens. */
const UNKNOWN_WIDGET: WidgetDefinition = {
  type: "unknown",
  name: "Unknown widget",
  category: "structure",
  glyph: "?",
  description: "This widget type is not registered.",
  fields: [],
  defaults: {},
  render: () => null,
};

function definitionOf(type: string): WidgetDefinition {
  return WIDGETS_BY_TYPE.get(type) ?? UNKNOWN_WIDGET;
}

function isKnownWidget(type: string): boolean {
  return WIDGETS_BY_TYPE.has(type);
}

function widgetsOfCategory(category: WidgetCategoryId): WidgetDefinition[] {
  return ALL_WIDGETS.filter((definition) => definition.category === category);
}

function createWidget(type: string): WidgetNode {
  const definition = definitionOf(type);

  return {
    id: createId("w"),
    type: definition.type,
    props: { ...definition.defaults },
  };
}

export {
  ALL_WIDGETS,
  createWidget,
  definitionOf,
  isKnownWidget,
  UNKNOWN_WIDGET,
  WIDGET_CATEGORIES,
  widgetsOfCategory,
};
