import type { ReactNode } from "react";

// What a widget shows the harness. `render` returns an element, so a story that
// needs state returns its own small component and keeps its hooks inside it.
type Story = {
  id: string;
  title: string;
  note?: string;
  render(): ReactNode;
};

type WidgetStories = {
  id: string;
  title: string;
  stories: readonly Story[];
};

export type { Story, WidgetStories };
