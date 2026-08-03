// Inline copies of the files in `assets/`. The prototype has no SVG loader, and
// an inline `<svg>` takes its colour from the surrounding text like the unit
// glyphs on the canvas do.

// Every source file is drawn on a `0 0 24 24` viewBox and sized in `em`, so an
// icon follows the font size of whatever it sits in.
type IconProps = {
  className?: string;
};

// `assets/send.svg`
function SendIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m5 12l-3 8.5L21.5 12L2 3.5zm0 0h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="square"
        strokeWidth="2"
      />
    </svg>
  );
}

// `assets/info-outline.svg`
function InfoIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11 17h2v-6h-2zm1.713-8.287Q13 8.425 13 8t-.288-.712T12 7t-.712.288T11 8t.288.713T12 9t.713-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8"
        fill="currentColor"
      />
    </svg>
  );
}

export { InfoIcon, SendIcon };
