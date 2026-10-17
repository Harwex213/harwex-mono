import { useEffect, useRef } from "react";
import type { FC, KeyboardEvent, ReactNode } from "react";

type TNamePart = {
  text: string;
  isMatch: boolean;
};

// Matching ignores case (SRCH-9). A name whose lower-case form changes length cannot map
// the found offsets back onto the original text, so it is shown without a highlight.
const splitByTerm = (name: string, term: string): readonly TNamePart[] => {
  const lowerName = name.toLowerCase();
  const lowerTerm = term.toLowerCase();

  if (lowerTerm.length === 0 || lowerName.length !== name.length) {
    return [{ text: name, isMatch: false }];
  }

  const parts: TNamePart[] = [];
  let start = 0;
  let index = lowerName.indexOf(lowerTerm);

  while (index !== -1) {
    if (index > start) {
      parts.push({ text: name.slice(start, index), isMatch: false });
    }

    parts.push({ text: name.slice(index, index + lowerTerm.length), isMatch: true });
    start = index + lowerTerm.length;
    index = lowerName.indexOf(lowerTerm, start);
  }

  if (start < name.length) {
    parts.push({ text: name.slice(start), isMatch: false });
  }

  return parts;
};

type THighlightedNameProps = {
  name: string;
  term: string;
};

const HighlightedName: FC<THighlightedNameProps> = ({ name, term }) => {
  const parts = splitByTerm(name, term);

  return (
    <span className="fs-viewer__name">
      {parts.map((part, index): ReactNode => {
        if (!part.isMatch) {
          return part.text;
        }

        return (
          <mark className="fs-viewer__mark" key={index}>
            {part.text}
          </mark>
        );
      })}
    </span>
  );
};

const SearchIcon: FC = () => {
  return (
    <svg className="fs-viewer__search-icon" height="13" viewBox="0 0 16 16" width="13">
      <circle cx="7" cy="7" fill="none" r="4.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.4 10.4 L14 14" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
};

const isFocusShortcut = (event: globalThis.KeyboardEvent) => {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyF";
};

type TSearchFieldProps = {
  term: string;
  onChange: (term: string) => void;
  onClear: () => void;
  // Down from the field moves into the tree, to the first listed row.
  onLeaveDown: () => void;
};

const SearchField: FC<TSearchFieldProps> = ({ term, onChange, onClear, onLeaveDown }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+Shift+F reaches the field from anywhere in the app. Plain Cmd/Ctrl+F stays
  // with the browser, so the reader can still find text inside an open document.
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isFocusShortcut(event)) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Escape clears the term first. A second Escape on the empty field leaves it.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();

      if (term.length > 0) {
        onClear();

        return;
      }

      inputRef.current?.blur();

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onLeaveDown();
    }
  };

  return (
    <div className="fs-viewer__search">
      <SearchIcon />

      <input
        aria-label="Search the vault"
        className="fs-viewer__search-input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search"
        ref={inputRef}
        spellCheck={false}
        title="Search the vault (Cmd/Ctrl+Shift+F)"
        type="text"
        value={term}
      />

      {term.length > 0 ? (
        <button
          aria-label="Clear the search"
          className="fs-viewer__search-clear"
          onClick={() => {
            onClear();
            inputRef.current?.focus();
          }}
          title="Clear (Escape)"
          type="button"
        >
          {"×"}
        </button>
      ) : null}
    </div>
  );
};

export { HighlightedName, SearchField, splitByTerm };
