import type { ReactNode } from "react";
import { LAYOUT_ORDER, LAYOUTS } from "../data/layouts";
import { definitionOf } from "../data/widget-registry";
import { findContainer, findSection, findWidget, pageOfSection } from "../store/doc-utils";
import { useActivePage, useEditor } from "../store/editor-context";
import type { PageNode, PropField, SectionBackground, SectionNode, WidgetNode } from "../types";
import { PropControl } from "./fields";

const BACKGROUNDS: { value: SectionBackground; label: string }[] = [
  { value: "base", label: "Page" },
  { value: "surface", label: "Surface" },
  { value: "brand", label: "Brand" },
  { value: "dark", label: "Dark" },
  { value: "transparent", label: "Transparent" },
];

const SECTION_FIELDS: PropField[] = [
  { key: "paddingY", label: "Vertical padding", type: "range", min: 0, max: 120, step: 4 },
  { key: "gap", label: "Column gap", type: "range", min: 0, max: 64, step: 2 },
  { key: "maxWidth", label: "Content width", type: "range", min: 0, max: 1600, step: 20, hint: "0 = full bleed" },
];

function PageInspector({ page }: { page: PageNode }): ReactNode {
  const { dispatch } = useEditor();
  const widgets = page.sections.reduce(
    (total, section) => total + section.containers.reduce((count, container) => count + container.widgets.length, 0),
    0,
  );

  return (
    <>
      <div className="tb-inspector__head">
        <span className="tb-inspector__kind">Page</span>
        <span className="tb-inspector__title">{page.name}</span>
      </div>

      <div className="tb-group">
        <PropControl
          field={{ key: "name", label: "Page name", type: "text" }}
          value={page.name}
          onChange={(value) => dispatch({ type: "update-page", pageId: page.id, patch: { name: String(value) } })}
        />
        <PropControl
          field={{ key: "path", label: "URL path", type: "text" }}
          value={page.path}
          onChange={(value) => dispatch({ type: "update-page", pageId: page.id, patch: { path: String(value) } })}
        />
      </div>

      <div className="tb-group">
        <div className="tb-group__title">Contents</div>
        <div className="tb-stats">
          <span>
            <b>{page.sections.length}</b> sections
          </span>
          <span>
            <b>{widgets}</b> widgets
          </span>
        </div>
      </div>

      <p className="tb-panel__note">
        Select a section or widget on the canvas to edit it. Press Esc to come back to page settings.
      </p>
    </>
  );
}

function SectionInspector({ section }: { section: SectionNode }): ReactNode {
  const { dispatch } = useEditor();

  return (
    <>
      <div className="tb-inspector__head">
        <span className="tb-inspector__kind">Section</span>
        <span className="tb-inspector__title">{section.name}</span>
      </div>

      <div className="tb-group">
        <PropControl
          field={{ key: "name", label: "Name", type: "text" }}
          value={section.name}
          onChange={(value) => dispatch({ type: "update-section", sectionId: section.id, patch: { name: String(value) } })}
        />
      </div>

      <div className="tb-group">
        <div className="tb-group__title">Layout</div>
        <div className="tb-layouts tb-layouts--compact">
          {LAYOUT_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={section.layout === id ? "tb-layouts__item is-active" : "tb-layouts__item"}
              onClick={() => dispatch({ type: "set-section-layout", sectionId: section.id, layout: id })}
              title={LAYOUTS[id].label}
            >
              <span className="tb-layouts__preview">
                {LAYOUTS[id].columns.map((weight, index) => (
                  <span key={index} style={{ flexGrow: weight }} />
                ))}
              </span>
              <span className="tb-layouts__label">{LAYOUTS[id].label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tb-group">
        <div className="tb-group__title">Style</div>
        <PropControl
          field={{
            key: "background",
            label: "Background",
            type: "select",
            options: BACKGROUNDS.map((item) => ({ value: item.value, label: item.label })),
          }}
          value={section.style.background}
          onChange={(value) =>
            dispatch({
              type: "update-section",
              sectionId: section.id,
              patch: { style: { background: value as SectionBackground } },
            })
          }
        />
        {SECTION_FIELDS.map((field) => (
          <PropControl
            key={field.key}
            field={field}
            value={section.style[field.key as "paddingY" | "gap" | "maxWidth"]}
            onChange={(value) =>
              dispatch({
                type: "update-section",
                sectionId: section.id,
                patch: { style: { [field.key]: Number(value) } },
              })
            }
          />
        ))}
      </div>

      <div className="tb-inspector__actions">
        <button
          type="button"
          className="tb-btn"
          onClick={() => dispatch({ type: "duplicate-section", sectionId: section.id })}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="tb-btn tb-btn--danger"
          onClick={() => dispatch({ type: "delete-section", sectionId: section.id })}
        >
          Delete section
        </button>
      </div>
    </>
  );
}

function WidgetInspector({ widget }: { widget: WidgetNode }): ReactNode {
  const { dispatch } = useEditor();
  const definition = definitionOf(widget.type);

  return (
    <>
      <div className="tb-inspector__head">
        <span className="tb-inspector__kind">Widget</span>
        <span className="tb-inspector__title">
          <span aria-hidden="true">{definition.glyph}</span> {definition.name}
        </span>
        <span className="tb-inspector__sub">{definition.description}</span>
      </div>

      <div className="tb-group">
        {definition.fields.length === 0 ? <p className="tb-panel__note">This widget has no options.</p> : null}
        {definition.fields.map((field) => (
          <PropControl
            key={field.key}
            field={field}
            value={widget.props[field.key]}
            onChange={(value) =>
              dispatch({ type: "update-widget-prop", widgetId: widget.id, key: field.key, value })
            }
          />
        ))}
      </div>

      <div className="tb-inspector__actions">
        <button type="button" className="tb-btn" onClick={() => dispatch({ type: "reset-widget", widgetId: widget.id })}>
          Reset
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={() => dispatch({ type: "duplicate-widget", widgetId: widget.id })}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="tb-btn tb-btn--danger"
          onClick={() => dispatch({ type: "delete-widget", widgetId: widget.id })}
        >
          Delete
        </button>
      </div>
    </>
  );
}

function Inspector(): ReactNode {
  const { state, dispatch } = useEditor();
  const page = useActivePage();
  const selection = state.selection;

  let body: ReactNode = <PageInspector page={page} />;

  if (selection?.kind === "section") {
    const section = findSection(state.doc, selection.id);

    if (section) {
      body = <SectionInspector section={section} />;
    }
  }

  if (selection?.kind === "widget") {
    const location = findWidget(state.doc, selection.id);

    if (location) {
      body = <WidgetInspector widget={location.widget} />;
    }
  }

  if (selection?.kind === "container") {
    const container = findContainer(state.doc, selection.id);
    const owner = state.doc.pages
      .flatMap((item) => item.sections)
      .find((section) => section.containers.some((item) => item.id === selection.id));

    if (container && owner) {
      body = (
        <>
          <div className="tb-inspector__head">
            <span className="tb-inspector__kind">Container</span>
            <span className="tb-inspector__title">{owner.name}</span>
            <span className="tb-inspector__sub">
              Slot {owner.containers.indexOf(container) + 1} of {owner.containers.length} · {container.widgets.length}{" "}
              widgets
            </span>
          </div>
          <div className="tb-group">
            <div className="tb-group__title">Widgets in this container</div>
            {container.widgets.length === 0 ? <p className="tb-panel__note">Empty. Drop a widget in.</p> : null}
            {container.widgets.map((widget) => (
              <button
                key={widget.id}
                type="button"
                className="tb-listbtn"
                onClick={() => dispatch({ type: "select", selection: { kind: "widget", id: widget.id } })}
              >
                <span aria-hidden="true">{definitionOf(widget.type).glyph}</span>
                {definitionOf(widget.type).name}
              </button>
            ))}
          </div>
          <div className="tb-inspector__actions">
            <button
              type="button"
              className="tb-btn"
              onClick={() => dispatch({ type: "select", selection: { kind: "section", id: owner.id } })}
            >
              Select parent section
            </button>
          </div>
        </>
      );
    }
  }

  const ownerPage = selection?.kind === "section" ? pageOfSection(state.doc, selection.id) : null;

  return (
    <aside className="tb-inspector">
      <div className="tb-inspector__crumb">
        {(ownerPage ?? page).name}
        {selection ? ` › ${selection.kind}` : ""}
      </div>
      {body}
    </aside>
  );
}

export { Inspector };
