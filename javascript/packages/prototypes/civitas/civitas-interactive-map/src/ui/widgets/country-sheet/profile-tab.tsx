import {
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CountryProfile } from "../../../domain/index";
import styles from "./country-sheet.module.css";

// The registration form of a country. Display only.

// A long text shows its first lines and a "more" button. A text that fits in
// those lines gets no button.
function LongText({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const proseRef = useRef<HTMLParagraphElement>(null);

  // Measured while closed: an open paragraph is never clipped.
  useLayoutEffect(() => {
    const prose = proseRef.current;
    if (prose === null || open) {
      return;
    }
    setClipped(prose.scrollHeight > prose.clientHeight);
  }, [text, open]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {text === "" ? (
        <p className={styles.empty}>не заполнено</p>
      ) : (
        <>
          <p className={styles.prose} data-open={open ? "true" : "false"} ref={proseRef}>
            {text}
          </p>
          {clipped || open ? (
            <button
              className={styles.more}
              type="button"
              onClick={() => {
                setOpen(!open);
              }}
            >
              {open ? "свернуть" : "ещё"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value} data-empty={value === "" ? "true" : "false"}>
        {value === "" ? "—" : value}
      </dd>
    </>
  );
}

function ProfileTab({ profile }: { profile: CountryProfile }) {
  return (
    <div className={styles.tabBody} aria-label="profile">
      <section className={styles.section}>
        <dl className={styles.fields}>
          <Field label="Столица" value={profile.capital} />
          <Field label="Регион" value={profile.region} />
          <Field label="Форма правления" value={profile.government} />
          <Field label="Выборы" value={profile.democraticElections ? "есть" : "нет"} />
          <Field label="Идеология" value={profile.ideology} />
          <Field label="Религия" value={profile.religion} />
        </dl>
      </section>
      <LongText title="История" text={profile.history} />
      <LongText title="Культура и быт" text={profile.culture} />
    </div>
  );
}

export { ProfileTab };
