import type { EdgeKind, NodeKind } from "./model";
import type { Role } from "./syntax";

type NodeTheme = {
  fill: string;
  head: string;
  line: string;
  title: string;
  label: string;
};

const palette = {
  text: "#f2f6fa",
  muted: "#8aa2b8",
  faint: "#5b7288",
  grid: "#132232",
  background: "#07111a",
};

const nodeThemes: Record<NodeKind, NodeTheme> = {
  class: {
    fill: "#12202e",
    head: "#1b3348",
    line: "#2f5578",
    title: "#f2f6fa",
    label: "#7fc2ff",
  },
  type: {
    fill: "#16202a",
    head: "#1f3630",
    line: "#2f6b53",
    title: "#eafaf1",
    label: "#6fd6a4",
  },
};

// The method rows are painted token by token. A type takes the colour of its
// node, the rest is the same on every card.
const syntaxThemes: Record<Exclude<Role, "type">, string> = {
  name: "#ffd79a",
  param: "#dbe6f1",
  keyword: "#c792ea",
  punct: "#5f7488",
};

const edgeThemes: Record<EdgeKind, string> = {
  extends: "#ffd166",
  creates: "#7fc2ff",
  uses: "#5f8099",
};

const edgeTitles: Record<EdgeKind, string> = {
  extends: "наследует",
  creates: "создаёт",
  uses: "использует",
};

const nodeTitles: Record<NodeKind, string> = {
  class: "класс",
  type: "тип",
};

export { edgeThemes, edgeTitles, nodeThemes, nodeTitles, palette, syntaxThemes };
export type { NodeTheme };
