import { useEffect, useState } from "react";
import type { FC } from "react";
import type { TDemoEntry } from "./demos";

type TPlaygroundProps = {
  demos: readonly TDemoEntry[];
};

const readHash = (): string => {
  return window.location.hash.replace(/^#/, "");
};

const Playground: FC<TPlaygroundProps> = ({ demos }) => {
  const [slug, setSlug] = useState(readHash);

  useEffect(() => {
    const handleHashChange = () => {
      setSlug(readHash());
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Several people run the playground at once; each one opens the demo they are working
  // on through the hash, and the first demo is the fallback.
  const active = demos.find((demo) => demo.slug === slug) ?? demos[0];

  return (
    <div className="playground">
      <nav className="playground__nav">
        <h1 className="playground__title">{"Components"}</h1>

        {demos.map((demo) => (
          <a
            className={`playground__link${demo === active ? " playground__link--active" : ""}`}
            href={`#${demo.slug}`}
            key={demo.slug}
          >
            {demo.title}
          </a>
        ))}

        {demos.length === 0 ? (
          <p className="playground__empty">
            {"No demos yet. Add src/components/<name>/<name>.demo.tsx"}
          </p>
        ) : null}
      </nav>

      <main className="playground__stage">
        {active ? (
          <>
            <h2 className="playground__heading">{active.title}</h2>
            <div className="playground__canvas" key={active.slug}>
              <active.component />
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
};

export { Playground };
