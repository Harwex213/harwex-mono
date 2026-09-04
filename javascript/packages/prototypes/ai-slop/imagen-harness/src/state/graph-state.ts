import { batch, computed, effect, signal } from "@preact/signals-react";
import type {
  Graph,
  GraphEdge,
  GraphNode,
  ImageGeneratorNode,
  NodeKind,
  PromptGeneratorNode,
  Recent,
  RunInput,
  RunStatus,
  Tab,
} from "../../shared/types.js";
import { IMAGE_DIMENSIONS, IMAGE_MODELS } from "../../shared/types.js";
import { harness, newId } from "./bridge.js";

interface RunState {
  status: RunStatus;
  note: string;
}

const tabs = signal<Tab[]>([]);
const activeTabId = signal<string | null>(null);
/** Every working directory the app has ever opened, newest first. */
const recents = signal<Recent[]>([]);
const activeTab = computed(() => {
  return tabs.value.find((tab) => tab.id === activeTabId.value) ?? null;
});

const nodes = signal<GraphNode[]>([]);
const edges = signal<GraphEdge[]>([]);
const selectedId = signal<string | null>(null);
/** Prompt bodies, read out of `prompts/` and kept here so a card can render one. */
const promptTexts = signal<Record<string, string>>({});
/** Bumped after a write so the image element refetches instead of showing the old file. */
const imageStamps = signal<Record<string, number>>({});
const runs = signal<Record<string, RunState>>({});
const notice = signal("");

/** Autosave has to stay quiet while a tab's own graph is being poured in. */
let loadingGraph = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function startLoading(): void {
  loadingGraph = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

const NODE_WIDTH: Record<NodeKind, number> = {
  text: 260,
  "prompt-generator": 240,
  prompt: 300,
  "image-generator": 260,
  image: 300,
};

function nodeById(id: string): GraphNode | null {
  return nodes.value.find((node) => node.id === id) ?? null;
}

function setNotice(message: string): void {
  notice.value = message;
}

function setRun(id: string, state: RunState): void {
  runs.value = { ...runs.value, [id]: state };
}

function runOf(id: string): RunState {
  return runs.value[id] ?? { status: "idle", note: "" };
}

// --- tabs -----------------------------------------------------------------

async function loadGraphInto(tab: Tab): Promise<void> {
  startLoading();
  const graph = await harness.graph.load(tab.dir);
  const texts: Record<string, string> = {};
  await Promise.all(
    graph.nodes
      .filter((node) => node.kind === "prompt")
      .map(async (node) => {
        texts[node.id] = await harness.prompts.read(tab.dir, node.id);
      }),
  );
  batch(() => {
    nodes.value = graph.nodes;
    edges.value = graph.edges;
    promptTexts.value = texts;
    selectedId.value = null;
    runs.value = {};
  });
  // The save effect reads the new arrays once before this clears.
  queueMicrotask(() => {
    loadingGraph = false;
  });
}

async function selectTab(id: string): Promise<void> {
  const tab = tabs.value.find((entry) => entry.id === id);
  if (!tab) {
    return;
  }
  // Pointing at the tab before its graph is in hand would let the save effect
  // see the new directory holding the previous canvas — or an empty one.
  startLoading();
  activeTabId.value = id;
  await loadGraphInto(tab);
}

async function refreshRecents(): Promise<void> {
  recents.value = await harness.recents.list();
}

async function initTabs(): Promise<void> {
  const list = await harness.tabs.list();
  tabs.value = list;
  const first = list[0];
  if (first) {
    await selectTab(first.id);
  }
  await refreshRecents();
}

/** Takes a tab out of the strip and moves on to whatever is left. */
async function settleTabs(goneId: string, remaining: Tab[]): Promise<void> {
  tabs.value = remaining;
  if (activeTabId.value !== goneId) {
    return;
  }
  const next = remaining[0];
  if (next) {
    await selectTab(next.id);
    return;
  }
  batch(() => {
    activeTabId.value = null;
    nodes.value = [];
    edges.value = [];
  });
}

async function createTab(): Promise<void> {
  const tab = await harness.tabs.create();
  if (!tab) {
    return;
  }
  if (!tabs.value.some((entry) => entry.id === tab.id)) {
    tabs.value = [...tabs.value, tab];
  }
  await selectTab(tab.id);
  await refreshRecents();
}

/** Opens a directory the app has worked in before, graph and all. */
async function openRecent(dir: string): Promise<void> {
  const already = tabs.value.find((tab) => tab.dir === dir);
  if (already) {
    await selectTab(already.id);
    return;
  }
  const tab = await harness.recents.open(dir);
  if (!tab) {
    setNotice("That directory is not there any more.");
    await refreshRecents();
    return;
  }
  tabs.value = [...tabs.value, tab];
  await selectTab(tab.id);
  await refreshRecents();
}

/** Drops a directory from the list. Its files are left exactly where they are. */
async function forgetRecent(dir: string): Promise<void> {
  const open = tabs.value.find((tab) => tab.dir === dir);
  recents.value = await harness.recents.forget(dir);
  if (open) {
    await settleTabs(
      open.id,
      tabs.value.filter((tab) => tab.dir !== dir),
    );
  }
}

async function closeTab(id: string): Promise<void> {
  const remaining = await harness.tabs.close(id);
  await settleTabs(id, remaining);
  await refreshRecents();
}

// --- saving ---------------------------------------------------------------

effect(() => {
  const graph: Graph = { version: 1, nodes: nodes.value, edges: edges.value };
  const tab = activeTab.value;
  if (!tab || loadingGraph) {
    return;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    void harness.graph.save(tab.dir, graph);
  }, 500);
});

// --- editing --------------------------------------------------------------

function patchNode(id: string, patch: Partial<GraphNode>): void {
  nodes.value = nodes.value.map((node) => {
    return node.id === id ? ({ ...node, ...patch } as GraphNode) : node;
  });
}

function moveNode(id: string, x: number, y: number): void {
  patchNode(id, { x, y });
}

function addNode(kind: NodeKind, x: number, y: number): GraphNode | null {
  const model = IMAGE_MODELS[0];
  const dimensions = IMAGE_DIMENSIONS[0];
  let node: GraphNode | null = null;
  if (kind === "text") {
    node = { id: newId("text"), kind, x, y, text: "" };
  }
  if (kind === "prompt-generator") {
    node = { id: newId("pgen"), kind, x, y, outputId: null };
  }
  if (kind === "image-generator") {
    node = { id: newId("igen"), kind, x, y, model, dimensions };
  }
  if (!node) {
    return null;
  }
  const created = node;
  batch(() => {
    nodes.value = [...nodes.value, created];
    selectedId.value = created.id;
  });
  return created;
}

/** Everything wired into `id`, in the order the nodes were laid down. */
function sourcesOf(id: string): GraphNode[] {
  const sourceIds = edges.value.filter((edge) => edge.to === id).map((edge) => edge.from);
  return nodes.value.filter((node) => sourceIds.includes(node.id));
}

function targetsOf(id: string): GraphNode[] {
  const targetIds = edges.value.filter((edge) => edge.from === id).map((edge) => edge.to);
  return nodes.value.filter((node) => targetIds.includes(node.id));
}

function canConnect(from: GraphNode, to: GraphNode): boolean {
  if (from.id === to.id) {
    return false;
  }
  if (from.kind === "prompt-generator" || from.kind === "image-generator") {
    return false;
  }
  if (to.kind === "prompt-generator") {
    return from.kind === "text" || from.kind === "image";
  }
  return to.kind === "image-generator";
}

function connect(fromId: string, toId: string): void {
  const from = nodeById(fromId);
  const to = nodeById(toId);
  if (!from || !to || !canConnect(from, to)) {
    return;
  }
  const exists = edges.value.some((edge) => edge.from === fromId && edge.to === toId);
  if (exists) {
    return;
  }
  edges.value = [...edges.value, { id: newId("edge"), from: fromId, to: toId }];
}

function disconnect(edgeId: string): void {
  const edge = edges.value.find((entry) => entry.id === edgeId);
  if (!edge) {
    return;
  }
  const to = nodeById(edge.to);
  // A prompt node hangs off its generator for life, so that edge is not a user's to cut.
  if (to?.kind === "prompt") {
    setNotice("A prompt node cannot be unlinked from its generator.");
    return;
  }
  edges.value = edges.value.filter((entry) => entry.id !== edgeId);
}

/** Deletes a node, the file it owns, and whatever cannot outlive it. */
async function deleteNode(id: string): Promise<void> {
  const tab = activeTab.value;
  const node = nodeById(id);
  if (!tab || !node) {
    return;
  }
  const doomed = new Set<string>([id]);
  if (node.kind === "prompt-generator" && node.outputId) {
    doomed.add(node.outputId);
  }

  for (const doomedId of doomed) {
    const target = nodeById(doomedId);
    if (target?.kind === "prompt") {
      await harness.files.remove(tab.dir, "prompt", doomedId);
    }
    if (target?.kind === "image") {
      await harness.files.remove(tab.dir, "image", doomedId);
    }
  }

  batch(() => {
    nodes.value = nodes.value
      .filter((entry) => !doomed.has(entry.id))
      .map((entry) => {
        if (entry.kind === "prompt-generator" && entry.outputId && doomed.has(entry.outputId)) {
          return { ...entry, outputId: null };
        }
        if (entry.kind === "image" && entry.generatorId && doomed.has(entry.generatorId)) {
          return { ...entry, generatorId: null };
        }
        return entry;
      });
    edges.value = edges.value.filter((edge) => {
      return !doomed.has(edge.from) && !doomed.has(edge.to);
    });
    if (selectedId.value && doomed.has(selectedId.value)) {
      selectedId.value = null;
    }
  });
}

// --- runs -----------------------------------------------------------------

function promptInputs(generatorId: string): RunInput[] {
  const inputs: RunInput[] = [];
  for (const node of sourcesOf(generatorId)) {
    if (node.kind === "text") {
      inputs.push({ kind: "text", text: node.text });
    }
    if (node.kind === "image") {
      inputs.push({ kind: "image", id: node.id });
    }
  }
  return inputs;
}

function imageInputs(generatorId: string): RunInput[] {
  const inputs: RunInput[] = [];
  for (const node of sourcesOf(generatorId)) {
    if (node.kind === "text") {
      inputs.push({ kind: "text", text: node.text });
    }
    if (node.kind === "prompt") {
      inputs.push({ kind: "prompt", id: node.id });
    }
    if (node.kind === "image") {
      inputs.push({ kind: "image", id: node.id });
    }
  }
  return inputs;
}

function placeOutput(generator: GraphNode, kind: NodeKind, index: number): { x: number; y: number } {
  return {
    x: generator.x + NODE_WIDTH[generator.kind] + 90,
    y: generator.y + index * (kind === "image" ? 300 : 200),
  };
}

async function runPromptGenerator(id: string): Promise<void> {
  const tab = activeTab.value;
  const generator = nodeById(id);
  if (!tab || generator?.kind !== "prompt-generator") {
    return;
  }
  const inputs = promptInputs(id);
  if (inputs.length === 0) {
    setRun(id, { status: "failed", note: "Wire a note or an image in first." });
    return;
  }

  const existing = generator.outputId ? nodeById(generator.outputId) : null;
  const targetId = existing?.id ?? newId("prompt");
  if (!existing) {
    const spot = placeOutput(generator, "prompt", 0);
    batch(() => {
      nodes.value = [
        ...nodes.value,
        { id: targetId, kind: "prompt", x: spot.x, y: spot.y, generatorId: id, expanded: false },
      ];
      edges.value = [...edges.value, { id: newId("edge"), from: id, to: targetId }];
      patchNode(id, { outputId: targetId } as Partial<PromptGeneratorNode>);
    });
  }

  setRun(id, { status: "running", note: "Writing the prompt…" });
  const result = await harness.run.prompt({ dir: tab.dir, generatorId: id, targetId, inputs });
  if (!result.ok) {
    setRun(id, { status: "failed", note: result.message });
    if (!existing) {
      await deleteNode(targetId);
    }
    return;
  }
  const text = await harness.prompts.read(tab.dir, targetId);
  batch(() => {
    promptTexts.value = { ...promptTexts.value, [targetId]: text };
    setRun(id, { status: "done", note: "" });
  });
}

async function runImageGenerator(id: string): Promise<void> {
  const tab = activeTab.value;
  const generator = nodeById(id);
  if (!tab || generator?.kind !== "image-generator") {
    return;
  }
  const inputs = imageInputs(id);
  if (inputs.length === 0) {
    setRun(id, { status: "failed", note: "Wire a prompt, a note or an image in first." });
    return;
  }

  // A rerun never overwrites: every run gets a node of its own.
  const alreadyMade = targetsOf(id).filter((node) => node.kind === "image").length;
  const targetId = newId("image");
  const spot = placeOutput(generator, "image", alreadyMade);
  batch(() => {
    nodes.value = [
      ...nodes.value,
      { id: targetId, kind: "image", x: spot.x, y: spot.y, generatorId: id, caption: "" },
    ];
    edges.value = [...edges.value, { id: newId("edge"), from: id, to: targetId }];
  });

  setRun(id, { status: "running", note: `Generating with ${generator.model}…` });
  const result = await harness.run.image({
    dir: tab.dir,
    generatorId: id,
    targetId,
    inputs,
    model: generator.model,
    dimensions: generator.dimensions,
  });
  if (!result.ok) {
    setRun(id, { status: "failed", note: result.message });
    await deleteNode(targetId);
    return;
  }
  batch(() => {
    imageStamps.value = { ...imageStamps.value, [targetId]: Date.now() };
    patchNode(targetId, { caption: `${generator.model} · ${generator.dimensions}` });
    setRun(id, { status: "done", note: "" });
  });
}

harness.run.subscribe((event) => {
  if (event.type === "tool") {
    const label = event.detail.length > 0 ? `${event.name} · ${event.detail}` : event.name;
    setRun(event.generatorId, { status: "running", note: label });
  }
});

// --- clipboard ------------------------------------------------------------

/** Puts a node's content on the system clipboard. Images go as pixels, not as a path. */
async function copyNode(id: string): Promise<void> {
  const tab = activeTab.value;
  const node = nodeById(id);
  if (!tab || !node) {
    return;
  }
  if (node.kind === "text") {
    await navigator.clipboard.writeText(node.text);
    setNotice("Text copied.");
    return;
  }
  if (node.kind === "prompt") {
    await navigator.clipboard.writeText(promptTexts.value[node.id] ?? "");
    setNotice("Prompt copied.");
    return;
  }
  if (node.kind === "image") {
    await harness.files.copyImage(tab.dir, node.id);
    setNotice("Image copied.");
    return;
  }
  setNotice("That node holds nothing to copy.");
}

/** Writes bytes as a new image node. Used by paste and by drag-and-drop. */
async function addImageFromBytes(bytes: ArrayBuffer, x: number, y: number): Promise<void> {
  const tab = activeTab.value;
  if (!tab) {
    return;
  }
  const id = newId("image");
  await harness.files.writeImage(tab.dir, id, bytes);
  batch(() => {
    nodes.value = [...nodes.value, { id, kind: "image", x, y, generatorId: null, caption: "pasted" }];
    imageStamps.value = { ...imageStamps.value, [id]: Date.now() };
    selectedId.value = id;
  });
}

/** The clipboard image, as its own node. Nothing happens when there is no image. */
async function pasteImage(x: number, y: number): Promise<boolean> {
  const bytes = await harness.files.readClipboardImage();
  if (!bytes) {
    return false;
  }
  await addImageFromBytes(bytes, x, y);
  return true;
}

function setModel(id: string, model: string): void {
  patchNode(id, { model } as Partial<ImageGeneratorNode>);
}

function setDimensions(id: string, dimensions: string): void {
  patchNode(id, { dimensions } as Partial<ImageGeneratorNode>);
}

export {
  activeTab,
  activeTabId,
  addImageFromBytes,
  addNode,
  canConnect,
  closeTab,
  connect,
  copyNode,
  createTab,
  deleteNode,
  disconnect,
  edges,
  forgetRecent,
  imageStamps,
  initTabs,
  moveNode,
  nodeById,
  nodes,
  NODE_WIDTH,
  notice,
  openRecent,
  pasteImage,
  patchNode,
  promptTexts,
  recents,
  refreshRecents,
  runImageGenerator,
  runOf,
  runPromptGenerator,
  runs,
  selectedId,
  selectTab,
  setDimensions,
  setModel,
  setNotice,
  tabs,
};
