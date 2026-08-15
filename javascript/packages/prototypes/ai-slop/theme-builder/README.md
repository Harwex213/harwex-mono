# Theme Builder — Sportsbook

A Webflow-style visual editor for composing a sportsbook site: pages on the left, a live canvas in
the middle, an inspector on the right. Sections hold containers, containers hold widgets, and a set
of theme tokens repaints every page at once.

## Run

```bash
yarn dev        # rspack dev server on a random free port
yarn build      # bundle into dist/
yarn typecheck  # tsc --noEmit
```

## The editor

**Top bar** — site name, breakpoint switcher (desktop 1320 / tablet 834 / mobile 390), undo, redo,
import JSON, copy JSON, download JSON, reset to the starter site, preview toggle.

**Left panel**

- *Pages* — the site map. Add, reorder, duplicate and delete pages; click one to open it.
- *Add* — section layouts and the widget library. Drag onto the canvas, or click to append.
- *Layers* — the section → container → widget tree of the open page.
- *Theme* — four presets plus every token: six colours, corner radius, density, typeface.

**Canvas** — the page as it renders. Hovering shows section, container and widget outlines; the blue
tag on each one carries its tools. The frame is zoomed to fit between the panels, so a desktop
layout stays a desktop layout at any window size.

**Inspector** — whatever is selected. Page name and URL, section layout and style, or the widget's
own fields, generated from that widget's definition.

### Drag and drop

- Widget from the Add panel → any container. A blue line marks the insertion point.
- Widget already on the canvas → any container, including across sections.
- Section layout from the Add panel → the gap between two sections.

### Keyboard

| Key | Action |
| --- | --- |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⇧⌘Z` / `Ctrl+Shift+Z` | Redo |
| `Backspace` / `Delete` | Delete the selected widget or section |
| `Esc` | Clear the selection |

## Document model

```
SiteDoc
  name
  theme     ThemeTokens          → CSS custom properties on the canvas frame
  pages[]   PageNode             → name, URL path
    sections[]  SectionNode      → layout, background, padding, gap, content width
      containers[]  ContainerNode → the only place widgets live
        widgets[]  WidgetNode     → type + props
```

`SiteDoc` is the whole deliverable: it autosaves to `localStorage` 400 ms after every edit, it is
what the export button writes, and it is what undo and redo step through. Editor-only state —
selection, breakpoint, preview, active tab — sits outside it and is never saved.

Six section layouts (full width, two/three/four columns, sidebar left, sidebar right) decide the
container count. Changing the layout of a populated section never drops work: widgets from removed
containers are appended to the last surviving one.

Undo coalesces streams of edits. Dragging a slider or typing a caption is one history entry, not one
per event; the signature that groups them is computed in `coalesceKeyOf`.

## Widget catalogue

29 sportsbook widgets in five categories:

- **Structure** — site header, sports menu, search bar, rich text, CTA banner, media block, footer.
- **Betting** — event list, bet slip, bet builder, boosted price, my bets, standings, results.
- **In-play** — live now, scoreboard, live stream, countdown.
- **Promotions** — hero banner, promo strip, promotions grid, jackpot ticker, top winners, virtual
  sports, casino cross-sell.
- **Account** — login/register, account summary, payment methods, responsible gaming.

Every widget renders sample fixtures, so a page looks like a sportsbook the moment it is composed.
Odds render as decimal, fractional or American where the widget offers the choice.

## Adding a widget

1. Write the definition in `src/data/widgets/<category>-widgets.tsx`:

```tsx
const cashOutBanner: WidgetDefinition = {
  type: "cash-out-banner",
  name: "Cash out banner",
  category: "betting",
  glyph: "💸",
  description: "Explains cash out with a live example.",
  fields: [{ key: "title", label: "Title", type: "text" }],
  defaults: { title: "Cash out any time" },
  render: (props) => <div className="sb-block">{str(props, "title")}</div>,
};
```

2. Add it to that file's exported array. `widget-registry.ts` picks it up, and the Add panel, the
   inspector and the layer tree all follow — the `fields` list *is* the inspector form.
3. Style it in `src/styles/widgets.css` using the `--sb-*` tokens so it follows the theme.

## Layout of the source

```
src/
  components/     editor shell: top bar, panels, canvas, inspector, field controls
  data/
    widgets/      widget definitions grouped by category
    widget-registry.ts  type → definition lookup
    layouts.ts    section layouts
    theme.ts      tokens and presets
    seed.ts       the starter six-page sportsbook
  store/
    actions.ts    the action union, and which actions touch the document
    reducer.ts    every edit, plus undo/redo
    doc-utils.ts  pure find/map/insert helpers over the document tree
    persistence.ts  localStorage, import, export
  dnd/            drag payload shared between the drag source and the drop targets
  styles/         builder chrome, canvas chrome, sportsbook widgets
```
