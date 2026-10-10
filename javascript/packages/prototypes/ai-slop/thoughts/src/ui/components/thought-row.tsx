import { memo, useLayoutEffect, useRef } from "react";
import { CATEGORIES } from "../../domain/thought";
import type { TThought } from "../../domain/thought";

type TThoughtRowProps = {
  thought: TThought;
};

// The text node is written by hand: ListGestures turns it into a contenteditable on tap,
// and React must not reconcile children the browser has edited.
const ThoughtRow = memo<TThoughtRowProps>(({ thought }) => {
  const textRef = useRef<HTMLDivElement>(null);
  const targets = CATEGORIES.filter((category) => category.id !== thought.category);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (text && !text.isContentEditable) {
      text.textContent = thought.text;
    }
  }, [thought.text]);

  return (
    <div className="row" data-id={thought.id}>
      <div className="row-actions">
        {targets.map((category) => (
          <button key={category.id} type="button" className="row-action" data-move={category.id}>
            <span className="row-action-emoji" aria-hidden="true">{category.emoji}</span>
            <span className="row-action-title">{category.title}</span>
          </button>
        ))}
      </div>
      <div className="row-surface">
        <div ref={textRef} className="row-text" spellCheck enterKeyHint="done" />
      </div>
    </div>
  );
});

export { ThoughtRow };
