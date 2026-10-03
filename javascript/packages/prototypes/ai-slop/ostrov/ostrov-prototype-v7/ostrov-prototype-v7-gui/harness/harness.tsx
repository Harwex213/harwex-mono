import { useEffect, useState } from "react";
import { themeVariables } from "../exports";
import { pages } from "./pages";
import type { WidgetStories } from "../src/story";

const readHash = (): string => {
  return window.location.hash.replace("#", "");
};

const useHash = (): string => {
  const [hash, setHash] = useState(readHash);

  useEffect(() => {
    const onChange = (): void => {
      setHash(readHash());
    };

    window.addEventListener("hashchange", onChange);

    return () => {
      window.removeEventListener("hashchange", onChange);
    };
  }, []);

  return hash;
};

const pageOf = (hash: string): WidgetStories => {
  const first = pages[0];

  if (!first) {
    throw new Error("The harness declares no widgets");
  }

  const page = pages.find((item) => {
    return item.id === hash;
  });

  return page ?? first;
};

const Harness = () => {
  const current = pageOf(useHash());

  return (
    <>
      <aside>
        <nav>
          {pages.map((page) => {
            return (
              <a
                key={page.id}
                href={`#${page.id}`}
                className={page.id === current.id ? "current" : undefined}
              >
                {page.title}
              </a>
            );
          })}
        </nav>
      </aside>
      <div className="stage">
        <h1>{current.title}</h1>
        <div className="tiles">
          {current.stories.map((story) => {
            return (
              <article
                className="tile"
                key={story.id}
              >
                <h2>{story.title}</h2>
                {story.note ? <p className="meta">{story.note}</p> : null}
                <div
                  className="preview"
                  style={themeVariables}
                >
                  {story.render()}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
};

export { Harness };
