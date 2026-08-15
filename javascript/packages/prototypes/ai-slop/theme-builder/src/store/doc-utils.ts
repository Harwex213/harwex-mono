import { containerCount } from "../data/layouts";
import { createId } from "../ids";
import type {
  ContainerNode,
  PageNode,
  SectionLayoutId,
  SectionNode,
  SiteDoc,
  WidgetNode,
} from "../types";

interface WidgetLocation {
  pageId: string;
  sectionId: string;
  containerId: string;
  index: number;
  widget: WidgetNode;
}

function findPage(doc: SiteDoc, pageId: string): PageNode | null {
  return doc.pages.find((page) => page.id === pageId) ?? null;
}

function findSection(doc: SiteDoc, sectionId: string): SectionNode | null {
  for (const page of doc.pages) {
    const section = page.sections.find((item) => item.id === sectionId);

    if (section) {
      return section;
    }
  }

  return null;
}

function findContainer(doc: SiteDoc, containerId: string): ContainerNode | null {
  for (const page of doc.pages) {
    for (const section of page.sections) {
      const container = section.containers.find((item) => item.id === containerId);

      if (container) {
        return container;
      }
    }
  }

  return null;
}

function findWidget(doc: SiteDoc, widgetId: string): WidgetLocation | null {
  for (const page of doc.pages) {
    for (const section of page.sections) {
      for (const container of section.containers) {
        const index = container.widgets.findIndex((item) => item.id === widgetId);

        if (index >= 0) {
          return {
            pageId: page.id,
            sectionId: section.id,
            containerId: container.id,
            index,
            widget: container.widgets[index],
          };
        }
      }
    }
  }

  return null;
}

function pageOfSection(doc: SiteDoc, sectionId: string): PageNode | null {
  return doc.pages.find((page) => page.sections.some((section) => section.id === sectionId)) ?? null;
}

function hasNode(doc: SiteDoc, kind: string, id: string): boolean {
  if (kind === "page") {
    return findPage(doc, id) !== null;
  }

  if (kind === "section") {
    return findSection(doc, id) !== null;
  }

  if (kind === "container") {
    return findContainer(doc, id) !== null;
  }

  return findWidget(doc, id) !== null;
}

function mapPages(doc: SiteDoc, fn: (page: PageNode) => PageNode): SiteDoc {
  return { ...doc, pages: doc.pages.map(fn) };
}

function mapSection(doc: SiteDoc, sectionId: string, fn: (section: SectionNode) => SectionNode): SiteDoc {
  return mapPages(doc, (page) => ({
    ...page,
    sections: page.sections.map((section) => (section.id === sectionId ? fn(section) : section)),
  }));
}

function mapContainer(doc: SiteDoc, containerId: string, fn: (container: ContainerNode) => ContainerNode): SiteDoc {
  return mapPages(doc, (page) => ({
    ...page,
    sections: page.sections.map((section) => ({
      ...section,
      containers: section.containers.map((container) => (container.id === containerId ? fn(container) : container)),
    })),
  }));
}

function mapWidget(doc: SiteDoc, widgetId: string, fn: (widget: WidgetNode) => WidgetNode): SiteDoc {
  return mapPages(doc, (page) => ({
    ...page,
    sections: page.sections.map((section) => ({
      ...section,
      containers: section.containers.map((container) => ({
        ...container,
        widgets: container.widgets.map((widget) => (widget.id === widgetId ? fn(widget) : widget)),
      })),
    })),
  }));
}

function removeWidget(doc: SiteDoc, widgetId: string): SiteDoc {
  return mapPages(doc, (page) => ({
    ...page,
    sections: page.sections.map((section) => ({
      ...section,
      containers: section.containers.map((container) => ({
        ...container,
        widgets: container.widgets.filter((widget) => widget.id !== widgetId),
      })),
    })),
  }));
}

function insertWidget(doc: SiteDoc, containerId: string, widget: WidgetNode, index: number): SiteDoc {
  return mapContainer(doc, containerId, (container) => {
    const widgets = [...container.widgets];
    const at = Math.max(0, Math.min(index, widgets.length));

    widgets.splice(at, 0, widget);

    return { ...container, widgets };
  });
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const target = Math.max(0, Math.min(to, next.length - 1));
  const [item] = next.splice(from, 1);

  next.splice(target, 0, item);

  return next;
}

function cloneWidget(widget: WidgetNode): WidgetNode {
  return {
    id: createId("w"),
    type: widget.type,
    props: { ...widget.props },
  };
}

function cloneSection(section: SectionNode): SectionNode {
  return {
    id: createId("s"),
    name: `${section.name} copy`,
    layout: section.layout,
    style: { ...section.style },
    containers: section.containers.map((container) => ({
      id: createId("c"),
      widgets: container.widgets.map(cloneWidget),
    })),
  };
}

function clonePage(page: PageNode): PageNode {
  return {
    id: createId("p"),
    name: `${page.name} copy`,
    path: `${page.path === "/" ? "/home" : page.path}-copy`,
    sections: page.sections.map((section) => ({ ...cloneSection(section), name: section.name })),
  };
}

/**
 * Fits the container list to a new layout. Widgets from dropped containers are
 * appended to the last surviving container, so a layout change never deletes work.
 */
function relayoutSection(section: SectionNode, layout: SectionLayoutId): SectionNode {
  const target = containerCount(layout);
  const containers = section.containers.map((container) => ({ ...container, widgets: [...container.widgets] }));

  while (containers.length < target) {
    containers.push({ id: createId("c"), widgets: [] });
  }

  if (containers.length > target) {
    const dropped = containers.splice(target);
    const last = containers[containers.length - 1];

    for (const container of dropped) {
      last.widgets.push(...container.widgets);
    }
  }

  return { ...section, layout, containers };
}

function emptySection(layout: SectionLayoutId, style: SectionNode["style"], name: string): SectionNode {
  return {
    id: createId("s"),
    name,
    layout,
    style: { ...style },
    containers: Array.from({ length: containerCount(layout) }, () => ({
      id: createId("c"),
      widgets: [],
    })),
  };
}

export type { WidgetLocation };
export {
  clonePage,
  cloneSection,
  cloneWidget,
  emptySection,
  findContainer,
  findPage,
  findSection,
  findWidget,
  hasNode,
  insertWidget,
  mapContainer,
  mapPages,
  mapSection,
  mapWidget,
  moveItem,
  pageOfSection,
  relayoutSection,
  removeWidget,
};
