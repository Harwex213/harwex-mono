import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ImageViewer } from "./image-viewer";
import type { TImageDocument } from "@hw/harwex-notes-protocol";
import type { TDemo } from "../../../dev/demo";

const toSvgUrl = (svg: string) => {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

// 48 x 32 PNG of four coloured blocks: small enough that 1:1 and zooming in show pixels.
const BLOCKS_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAARklEQVR42u3OsQnAIAAEQIeyTx2wMIu4W0rXEgIpXeKxOrgBrrTxRay3RhQhISEhISEhocOha/aI/7kjhISEhISEhIQOhzZ5+JCIZkHAJgAAAABJRU5ErkJggg==";

// Larger than any pane, so the default view has to shrink it to fit.
const POSTER_SVG = toSvgUrl(
  [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2400\" height=\"1500\" viewBox=\"0 0 2400 1500\">",
    "<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
    "<stop offset=\"0\" stop-color=\"#3b6ea5\"/><stop offset=\"1\" stop-color=\"#7b52c4\"/>",
    "</linearGradient></defs>",
    "<rect width=\"2400\" height=\"1500\" fill=\"url(#g)\"/>",
    "<circle cx=\"1200\" cy=\"750\" r=\"420\" fill=\"#f2b134\"/>",
    "<text x=\"1200\" y=\"790\" fill=\"#1d1c1a\" font-family=\"sans-serif\" font-size=\"120\" text-anchor=\"middle\">2400 x 1500</text>",
    "</svg>",
  ].join("")
);

// Half transparent, so the checkerboard behind it shows.
const BADGE_SVG = toSvgUrl(
  [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\" viewBox=\"0 0 200 200\">",
    "<circle cx=\"100\" cy=\"100\" r=\"90\" fill=\"#2f8a5b\" fill-opacity=\"0.6\"/>",
    "<path d=\"M60 100l28 28 52-60\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"14\"/>",
    "</svg>",
  ].join("")
);

const BROKEN_IMAGE = "data:image/png;base64,bm90IGFuIGltYWdl";

type TSample = {
  name: string;
  src: string;
};

const SAMPLES: readonly TSample[] = [
  { name: "blocks.png", src: BLOCKS_PNG },
  { name: "poster.svg", src: POSTER_SVG },
  { name: "badge.svg", src: BADGE_SVG },
  { name: "broken.png", src: BROKEN_IMAGE },
];

const sample = signal<TSample>(SAMPLES[0] as TSample);

const Demo = () => {
  useSignals();

  const current = sample.value;
  const document: TImageDocument = { kind: "image", nodeId: current.name, src: current.src };

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

        <span>{"Wheel zooms around the pointer, drag pans, double click switches fit and 1:1."}</span>
      </div>

      <div style={{ height: "70vh", border: "1px solid var(--color-border)" }}>
        <ImageViewer document={document} name={current.name} />
      </div>
    </div>
  );
};

const demo: TDemo = {
  title: "Image viewer",
  component: Demo,
};

export default demo;
