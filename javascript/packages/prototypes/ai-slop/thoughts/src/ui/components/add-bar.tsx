import { useRef, useState } from "react";
import type { FC, FormEvent, KeyboardEvent, PointerEvent } from "react";
import type { TAddThoughtAction } from "../../domain/registry";

const MAX_HEIGHT = 120;

type TAddBarRegistrySlice = {
  addThoughtAction: TAddThoughtAction;
};

type TAddBarProps = {
  registry: TAddBarRegistrySlice;
};

const autosize = (input: HTMLTextAreaElement) => {
  input.style.height = "auto";
  input.style.height = `${Math.min(MAX_HEIGHT, input.scrollHeight)}px`;
};

const scrollListToEnd = () => {
  requestAnimationFrame(() => {
    const list = document.querySelector(".list");
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  });
};

// Keeps the textarea focused, so the keyboard stays open between thoughts.
const keepFocus = (event: PointerEvent) => {
  event.preventDefault();
};

const AddBar: FC<TAddBarProps> = ({ registry }) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [hasText, setHasText] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const submit = () => {
    const input = inputRef.current;
    if (!input || input.value.trim() === "") {
      return;
    }

    registry.addThoughtAction(input.value);
    input.value = "";
    setHasText(false);
    autosize(input);
    scrollListToEnd();
  };

  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    autosize(event.currentTarget);
    setHasText(event.currentTarget.value.trim() !== "");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="add-bar" data-has-text={hasText ? "true" : "false"} data-focused={isFocused ? "true" : "false"}>
      <textarea
        ref={inputRef}
        className="add-input"
        rows={1}
        placeholder={isFocused ? "Новая мысль…" : "+"}
        aria-label="Новая мысль"
        enterKeyHint="send"
        autoCapitalize="sentences"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setIsFocused(true);
        }}
        onBlur={() => {
          setIsFocused(false);
        }}
      />
      <button type="button" className="add-send" aria-label="Добавить" onPointerDown={keepFocus} onClick={submit}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
        </svg>
      </button>
    </div>
  );
};

export { AddBar };
