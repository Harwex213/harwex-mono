import { useEffect, useId, useRef, useState } from "react";
import type { FC, KeyboardEvent } from "react";

// A long vault would make the list slow to scroll and useless to read. The filter is the
// way to reach a file past this count.
const MAX_SHOWN_PATHS = 200;

type TExcalidrawLinkPickerProps = {
  paths: readonly string[];
  onPick: (path: string) => void;
  onClose: () => void;
};

const filterPaths = (paths: readonly string[], term: string): readonly string[] => {
  const words = term.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return paths.slice(0, MAX_SHOWN_PATHS);
  }

  return paths
    .filter((candidate) => {
      const lower = candidate.toLowerCase();

      return words.every((word) => lower.includes(word));
    })
    .slice(0, MAX_SHOWN_PATHS);
};

const splitPath = (path: string): { folder: string; name: string } => {
  const slashIndex = path.lastIndexOf("/");

  return {
    folder: slashIndex === -1 ? "" : path.slice(0, slashIndex + 1),
    name: path.slice(slashIndex + 1),
  };
};

// The "Link to file" list (EX-9): a filter field over every file of the vault. Enter takes
// the highlighted row, the arrows move the highlight, Escape closes without a change.
const ExcalidrawLinkPicker: FC<TExcalidrawLinkPickerProps> = ({ paths, onPick, onClose }) => {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [term, setTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const shown = filterPaths(paths, term);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const row = listRef.current?.children[activeIndex];
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // Keys stay inside the picker. Excalidraw would otherwise take letters as tool shortcuts.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)));

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const picked = shown[activeIndex];
      if (picked !== undefined) {
        onPick(picked);
      }
    }
  };

  return (
    <div className="excalidraw-link-picker" onKeyDown={handleKeyDown}>
      <div aria-labelledby={titleId} className="excalidraw-link-picker__panel" role="dialog">
        <div className="excalidraw-link-picker__header">
          <span className="excalidraw-link-picker__title" id={titleId}>
            {"Link to file"}
          </span>

          <button
            aria-label={"Close"}
            className="excalidraw-link-picker__close"
            onClick={onClose}
            type="button"
          >
            {"×"}
          </button>
        </div>

        <input
          aria-label={"Filter files"}
          className="excalidraw-link-picker__input"
          onChange={(event) => {
            setTerm(event.target.value);
            setActiveIndex(0);
          }}
          placeholder={"Type to filter files…"}
          ref={inputRef}
          type="text"
          value={term}
        />

        {shown.length === 0 ? (
          <p className="excalidraw-link-picker__empty">{"No file matches."}</p>
        ) : (
          <ul className="excalidraw-link-picker__list" ref={listRef} role="listbox">
            {shown.map((path, index) => {
              const { folder, name } = splitPath(path);
              const isActive = index === activeIndex;

              return (
                <li
                  aria-selected={isActive}
                  className={`excalidraw-link-picker__row${isActive ? " excalidraw-link-picker__row--active" : ""}`}
                  key={path}
                  onClick={() => onPick(path)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                >
                  <span className="excalidraw-link-picker__name">{name}</span>
                  <span className="excalidraw-link-picker__folder">{folder}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export { ExcalidrawLinkPicker };
