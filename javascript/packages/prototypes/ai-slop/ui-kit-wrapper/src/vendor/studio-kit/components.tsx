import * as React from "react";
import { studioToast } from "./toast";
import styles from "./studio.module.css";

/**
 * Studio kit components. Pretend this is `node_modules`.
 *
 * The prop names are deliberately not the ones the Base UI kit uses:
 * `kind`/`scale` instead of `variant`/`size`, `caption` instead of `label`,
 * `off` instead of `disabled`, `onInput`/`onPick` instead of `onValueChange`,
 * `{ id, text }` instead of `{ value, label }`. Real kits disagree exactly like
 * this, and that disagreement is what the adapter absorbs.
 */

type StudioButtonProps = {
  children: React.ReactNode;
  kind?: "accent" | "outline" | "quiet" | "critical";
  scale?: "compact" | "regular";
  submit?: boolean;
  off?: boolean;
  busy?: boolean;
  onPress?: () => void;
};

function StudioButton({
  children,
  kind = "accent",
  scale = "regular",
  submit = false,
  off = false,
  busy = false,
  onPress,
}: StudioButtonProps) {
  const classes = [styles.button, styles[kind]];
  if (scale === "compact") {
    classes.push(styles.compact);
  }

  return (
    <button
      type={submit ? "submit" : "button"}
      className={classes.join(" ")}
      disabled={off || busy}
      onClick={onPress}
    >
      {busy ? <span className={styles.busyDot} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type StudioTextProps = {
  caption: string;
  value: string;
  onInput: (next: string) => void;
  kind?: "text" | "email";
  /** The kit spells "password" as a separate boolean. */
  secret?: boolean;
  ghostText?: string;
  note?: string;
  problem?: string;
  off?: boolean;
  mandatory?: boolean;
};

function StudioText({
  caption,
  value,
  onInput,
  kind = "text",
  secret = false,
  ghostText,
  note,
  problem,
  off = false,
  mandatory = false,
}: StudioTextProps) {
  const id = React.useId();
  const helpId = `${id}-help`;
  const classes = [styles.input];
  if (problem) {
    classes.push(styles.bad);
  }

  return (
    <div className={styles.control}>
      <label className={styles.caption} htmlFor={id}>
        {caption}
        {mandatory ? <span className={styles.star}>*</span> : null}
      </label>
      <input
        id={id}
        className={classes.join(" ")}
        type={secret ? "password" : kind}
        value={value}
        placeholder={ghostText}
        disabled={off}
        required={mandatory}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem || note ? helpId : undefined}
        onChange={(event) => onInput(event.target.value)}
      />
      {problem ? (
        <span id={helpId} className={styles.problem} role="alert">
          {problem}
        </span>
      ) : null}
      {!problem && note ? (
        <span id={helpId} className={styles.note}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

type StudioChoice = {
  id: string;
  text: string;
  off?: boolean;
};

type StudioPickerProps = {
  caption: string;
  current: string;
  choices: StudioChoice[];
  onPick: (id: string) => void;
  emptyText?: string;
  note?: string;
  problem?: string;
  off?: boolean;
};

/**
 * A styled native `<select>`. Plenty of in-house kits do this, and it is the
 * honest limit of the wrapper pattern: an adapter can hide an API, not
 * behaviour. Under this kit the dropdown is an OS menu — no custom item marks,
 * no typeahead into a listbox, different keyboard handling. The contract still
 * holds; the interaction is not identical.
 */
function StudioPicker({
  caption,
  current,
  choices,
  onPick,
  emptyText = "—",
  note,
  problem,
  off = false,
}: StudioPickerProps) {
  const id = React.useId();
  const helpId = `${id}-help`;
  const classes = [styles.picker];
  if (problem) {
    classes.push(styles.bad);
  }

  return (
    <div className={styles.control}>
      <label className={styles.caption} htmlFor={id}>
        {caption}
      </label>
      <span className={styles.pickerWrap}>
        <select
          id={id}
          className={classes.join(" ")}
          value={current}
          disabled={off}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem || note ? helpId : undefined}
          onChange={(event) => onPick(event.target.value)}
        >
          {current === "" ? <option value="">{emptyText}</option> : null}
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id} disabled={choice.off}>
              {choice.text}
            </option>
          ))}
        </select>
        <svg
          className={styles.chevron}
          viewBox="0 0 12 12"
          width="12"
          height="12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {problem ? (
        <span id={helpId} className={styles.problem} role="alert">
          {problem}
        </span>
      ) : null}
      {!problem && note ? (
        <span id={helpId} className={styles.note}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

type StudioToggleProps = {
  caption: string;
  on: boolean;
  onFlip: (next: boolean) => void;
  note?: string;
  off?: boolean;
};

/** A checkbox, not a sliding switch. Same job, different metaphor. */
function StudioToggle({ caption, on, onFlip, note, off = false }: StudioToggleProps) {
  return (
    <label className={styles.toggle}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={styles.toggleBox}
        disabled={off}
        onClick={() => onFlip(!on)}
      >
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" aria-hidden="true">
          <path
            d="M2 6.5 4.6 9 10 3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className={styles.toggleText}>
        <span className={styles.toggleCaption}>{caption}</span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </span>
    </label>
  );
}

type StudioTabsetProps = {
  tabs: Array<{ id: string; text: string }>;
  current: string;
  onPick: (id: string) => void;
  children: React.ReactNode;
};

/**
 * Only the body you pass is mounted. The Base UI kit mounts every panel and
 * hides the inactive ones. Behaviour a contract cannot paper over.
 */
function StudioTabset({ tabs, current, onPick, children }: StudioTabsetProps) {
  return (
    <div className={styles.tabset}>
      <div className={styles.tablist} role="tablist">
        {tabs.map((tab) => {
          const active = tab.id === current;
          const classes = [styles.tab];
          if (active) {
            classes.push(styles.tabOn);
          }

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={classes.join(" ")}
              onClick={() => onPick(tab.id)}
            >
              {tab.text}
            </button>
          );
        })}
      </div>
      <div className={styles.tabbody} role="tabpanel">
        {children}
      </div>
    </div>
  );
}

type StudioModalProps = {
  open: boolean;
  heading: string;
  onDismiss: () => void;
  /** Buttons come in as a prop, not as children. */
  footer: React.ReactNode;
  children: React.ReactNode;
};

/**
 * A native `<dialog>`: the browser supplies the backdrop, the focus trap, and
 * Escape. Nothing like the Base UI kit's Portal / Backdrop / Viewport / Popup
 * tree, and the footer arrives as a prop rather than as children.
 */
function StudioModal({ open, heading, onDismiss, footer, children }: StudioModalProps) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    }
    if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-label={heading}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          onDismiss();
        }
      }}
    >
      <div className={styles.modalHead}>
        <h2 className={styles.modalHeading}>{heading}</h2>
      </div>
      <div className={styles.modalBody}>{children}</div>
      <div className={styles.modalFoot}>{footer}</div>
    </dialog>
  );
}

const levelClass = {
  info: "",
  good: styles.slipGood,
  bad: styles.slipBad,
};

/** Reads the module-level store. Mount once, anywhere. */
function StudioToastRail() {
  const items = React.useSyncExternalStore(studioToast.subscribe, studioToast.getItems);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={styles.rail}>
      {items.map((item) => (
        <div key={item.id} className={`${styles.slip} ${levelClass[item.level]}`} role="status">
          <div className={styles.slipText}>
            <div className={styles.slipTitle}>{item.text}</div>
            {item.detail ? <div className={styles.slipDetail}>{item.detail}</div> : null}
          </div>
          <button
            type="button"
            className={styles.slipClose}
            aria-label="Dismiss"
            onClick={() => studioToast.dismiss(item.id)}
          >
            <svg viewBox="0 0 14 14" width="13" height="13" fill="none" aria-hidden="true">
              <path
                d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export {
  StudioButton,
  StudioModal,
  StudioPicker,
  StudioTabset,
  StudioText,
  StudioToastRail,
  StudioToggle,
};
export type {
  StudioButtonProps,
  StudioChoice,
  StudioModalProps,
  StudioPickerProps,
  StudioTabsetProps,
  StudioTextProps,
  StudioToggleProps,
};
