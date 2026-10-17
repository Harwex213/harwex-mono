import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { HtmlViewer } from "./html-viewer";
import type { THtmlDocument } from "@hw/harwex-notes-protocol";
import type { TDemo } from "../../../dev/demo";

const toHtmlUrl = (html: string) => {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

// The page runs a script and then tries to reach the app around it. Both attempts fail
// inside the sandbox, and the page reports what happened.
const SCRIPTED_PAGE = toHtmlUrl(
  [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><style>",
    "body { font-family: sans-serif; background: #fff8e6; color: #4a3b12; padding: 16px; }",
    "button { margin-right: 8px; }",
    "</style></head><body>",
    "<h1>Scripted page</h1>",
    "<p id=\"clock\">The script has not run.</p>",
    "<p><button id=\"top\">Navigate the app away</button><button id=\"read\">Read the app</button></p>",
    "<p id=\"result\"></p>",
    "<script>",
    "const clock = document.getElementById(\"clock\");",
    "setInterval(() => { clock.textContent = \"The script runs: \" + new Date().toLocaleTimeString(); }, 500);",
    "const report = (text) => { document.getElementById(\"result\").textContent = text; };",
    "document.getElementById(\"top\").onclick = () => {",
    "  try { window.top.location.href = \"https://example.com\"; report(\"Navigation was not blocked.\"); }",
    "  catch (error) { report(\"Blocked: \" + error.message); }",
    "};",
    "document.getElementById(\"read\").onclick = () => {",
    "  try { report(\"Read: \" + window.parent.document.title); }",
    "  catch (error) { report(\"Blocked: \" + error.message); }",
    "};",
    "</script>",
    "</body></html>",
  ].join("\n")
);

const PLAIN_PAGE = toHtmlUrl(
  [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><title>Plain</title></head><body>",
    "<h1>Plain page</h1>",
    "<p>No styles and no script, so the browser defaults show.</p>",
    "<ul><li>One</li><li>Two</li></ul>",
    "</body></html>",
  ].join("\n")
);

type TSample = {
  name: string;
  src: string;
};

const SAMPLES: readonly TSample[] = [
  { name: "scripted.html", src: SCRIPTED_PAGE },
  { name: "plain.htm", src: PLAIN_PAGE },
];

const sample = signal<TSample>(SAMPLES[0] as TSample);

const Demo = () => {
  useSignals();

  const current = sample.value;
  const document: THtmlDocument = { kind: "html", nodeId: current.name, src: current.src };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {SAMPLES.map((candidate) => {
          return (
            <button
              disabled={candidate.name === current.name}
              key={candidate.name}
              onClick={() => {
                sample.value = candidate;
              }}
              type="button"
            >
              {`Open ${candidate.name}`}
            </button>
          );
        })}
      </div>

      <div style={{ height: "70vh", border: "1px solid var(--color-border)" }}>
        <HtmlViewer document={document} name={current.name} />
      </div>
    </div>
  );
};

const demo: TDemo = {
  title: "HTML viewer",
  component: Demo,
};

export default demo;
