import type { AncestorTurn, AskRequest, ContextUsed } from "../shared/types.ts";

const SYSTEM_PROMPT = [
  "You are the tutor behind a branching learning canvas. The learner explores one",
  "topic as a tree: every card holds a question and your answer, and the learner",
  "branches off any answer to dig into whatever caught their attention.",
  "",
  "How to answer:",
  "- Lead with the answer. No preamble, no restating the question.",
  "- Structure with short markdown sections and lists. Bold the terms worth remembering.",
  "- Explain the mechanism, not just the label. Say why it works the way it does.",
  "- Use concrete examples, numbers, and small code blocks where they carry the idea.",
  "- Name the things a learner could branch into next, so the tree has obvious edges to pull.",
  "- Say plainly when something is contested or when you are unsure.",
  "- Aim for 200-500 words unless the question clearly needs more.",
  "",
  "You are answering one node of a tree, so a branch may pick up a single sentence",
  "of a previous answer. Read the supplied context as the path the learner walked",
  "to get here, and answer the current question in that light.",
].join("\n");

/** A short label for a node, derived from its prompt. */
function deriveTitle(prompt: string): string {
  const firstLine = prompt.trim().split("\n").find((line) => {
    return line.trim().length > 0;
  });
  if (!firstLine) {
    return "Untitled";
  }
  const clean = firstLine.trim().replace(/^#+\s*/, "");
  if (clean.length <= 70) {
    return clean;
  }
  return `${clean.slice(0, 69)}…`;
}

function describeImages(count: number): string {
  if (count === 0) {
    return "";
  }
  if (count === 1) {
    return "\n[1 image was attached to this question.]";
  }
  return `\n[${count} images were attached to this question.]`;
}

/**
 * Renders the walked path as an explicit transcript. Used when there is no live
 * agent session to fork from, so the whole branch has to travel in the prompt.
 */
function renderAncestors(ancestors: AncestorTurn[]): string {
  const steps = ancestors.map((turn, index) => {
    return [
      `### Step ${index + 1} — the learner asked`,
      `${turn.prompt.trim()}${describeImages(turn.imageCount)}`,
      "",
      `### Step ${index + 1} — you answered`,
      turn.answer.trim().length > 0 ? turn.answer.trim() : "(no answer was recorded)",
    ].join("\n");
  });
  return steps.join("\n\n");
}

/** Chooses fork-vs-rebuild, then writes the prompt text for that choice. */
function buildPrompt(request: AskRequest): { text: string; contextUsed: ContextUsed } {
  const question = request.prompt.trim();
  if (request.ancestors.length === 0) {
    return {
      contextUsed: "root",
      text: [
        "This is the root of a new learning tree.",
        "",
        "## Question",
        question,
      ].join("\n"),
    };
  }

  const canFork = request.parentSessionId !== null && request.contextMode !== "rebuild";
  const parent = request.ancestors[request.ancestors.length - 1];

  if (canFork) {
    return {
      contextUsed: "fork",
      text: [
        "The learner branched off your previous answer in this conversation.",
        `Branch depth: ${request.ancestors.length + 1}.`,
        "",
        "## Follow-up question",
        question,
      ].join("\n"),
    };
  }

  return {
    contextUsed: "rebuild",
    text: [
      "You are resuming a branching learning session from a written record — the",
      "live conversation is gone, so the path the learner walked is reproduced below.",
      "Treat it as your own earlier work.",
      "",
      "<learning-path>",
      renderAncestors(request.ancestors),
      "</learning-path>",
      "",
      `The learner is branching off your answer at step ${request.ancestors.length}`,
      `("${deriveTitle(parent.prompt)}"). Answer only the question below, but keep`,
      "everything above in mind and do not repeat what you already covered.",
      "",
      "## Follow-up question",
      question,
    ].join("\n"),
  };
}

export { buildPrompt, deriveTitle, SYSTEM_PROMPT };
