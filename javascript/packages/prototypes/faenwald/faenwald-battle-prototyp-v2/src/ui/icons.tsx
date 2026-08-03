// Inline copies of the files in `assets/`. The prototype has no SVG loader, and
// an inline `<svg>` takes its colour from the surrounding text like the unit
// glyphs on the canvas do.

// The source files come from several icon sets and are drawn on viewBoxes of
// their own, so each copy keeps the viewBox it was drawn on. Every one of them
// is sized in `em`, so an icon follows the font size of whatever it sits in.
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

// The six below stand for the orders on the unit card. They replace the words
// that used to name them, so each one is named after the order rather than after
// the shape it draws.

// `assets/forward-fill.svg`
function MoveIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 16 16"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m9.77 12.11l4.012-2.953a.647.647 0 0 0 0-1.114L9.771 5.09a.644.644 0 0 0-.971.557V6.65H2v3.9h6.8v1.003c0 .505.545.808.97.557"
        fill="currentColor"
      />
    </svg>
  );
}

// `assets/rotate.svg`
function RotateIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 2048 2048"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1024 768q53 0 99 20t82 55t55 81t20 100q0 53-20 99t-55 82t-81 55t-100 20q-53 0-99-20t-82-55t-55-81t-20-100q0-53 20-99t55-82t81-55t100-20m0 384q27 0 50-10t40-27t28-41t10-50q0-27-10-50t-27-40t-41-28t-50-10q-27 0-50 10t-40 27t-28 41t-10 50q0 27 10 50t27 40t41 28t50 10m1024-128q0 140-37 272t-105 248t-167 213t-221 163h274v128h-512v-512h128v297q117-55 211-140t162-190t103-228t36-251q0-123-32-237t-90-214t-141-182t-181-140t-214-91t-238-32q-123 0-237 32t-214 90t-182 141t-140 181t-91 214t-32 238H0q0-141 36-272t103-245t160-207t208-160T751 37t273-37q141 0 272 36t245 103t207 160t160 208t103 245t37 272"
        fill="currentColor"
      />
    </svg>
  );
}

// `assets/forward.svg`. The one icon of the six that is not square, so it keeps
// the width its source was drawn at.
function AccelerateIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 32 24"
      width="1.34em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M31.489 10.982L14.796.146c-.657-.427-1.463.136-1.463 1.02V7.85L1.462.15C.805-.277-.001.286-.001 1.17v21.663c0 .884.805 1.447 1.463 1.02l11.871-7.705v6.685c0 .884.805 1.447 1.463 1.02l16.693-10.835a1.27 1.27 0 0 0 .003-2.037l-.003-.002z"
        fill="currentColor"
      />
    </svg>
  );
}

// `assets/sword-attack-solid.svg`
function AttackIcon({ className }: IconProps) {
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
        clipRule="evenodd"
        d="M6.675 1.371H1.372v5.303L12.47 17.773l5.303-5.304zm14.81 12.336l-2.475 2.475l3.99 3.99V23h-2.83l-3.99-3.99l-2.474 2.475l-1.414-1.414l7.778-7.778z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

// `assets/high-shot.svg`
function CanopyIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 512 512"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="m492.656 20.406l-118.594 56.22L413.875 86l-86.97 86.97l-305.5 259.374l.69.687l104.75-47.467l-46.376 105.843l.905.906l272.5-319.875l73.22-73.218l9.342 39.81zm-473.25.063c-1.347 23.43 5 39.947 16.563 52.218l24.093 302.28l17.562-14.874l-21.72-272.438C113.879 119.609 225 112.82 272.811 194.375l66.625-56.564l1.22-1.218C292.74 38.666 86.01 99.716 19.406 20.47zm359.531 151.56l-1.156 1.157l-57.25 67.188c82.006 47.945 75.587 159.267 107.283 218.03l-272.157-24.5l-14.812 17.408l301.562 27.125c12.48 12.283 29.4 19.084 53.688 17.687c-79.95-67.2-18.36-275.754-117.156-324.094z"
        fill="currentColor"
      />
    </svg>
  );
}

// `assets/locate-fixed.svg`. Stroked rather than filled, so it keeps the stroke
// width its source was drawn at.
function FindIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M2 12h3m14 0h3M12 2v3m0 14v3" />
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>
  );
}

export {
  AccelerateIcon,
  AttackIcon,
  CanopyIcon,
  FindIcon,
  InfoIcon,
  MoveIcon,
  RotateIcon,
  SendIcon,
};
