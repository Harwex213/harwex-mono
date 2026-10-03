import type { FC } from "react";

/** `inline` sits in a line of text, `m` in a stat row, `l` in a button or a panel. */
type TIconSize = "inline" | "m" | "l";

type TIconProps = {
  src: string;
  /** Read by screen readers and shown on hover. Empty for a decorative icon. */
  label?: string;
  size?: TIconSize;
  className?: string;
};

/** One 64x64 game icon, scaled down by CSS to the size of its slot. */
const Icon: FC<TIconProps> = ({ src, label = "", size = "inline", className = "" }) => {
  return (
    <img
      className={`icon icon--${size} ${className}`}
      src={src}
      alt={label}
      title={label === "" ? undefined : label}
      width={64}
      height={64}
      draggable={false}
    />
  );
};

export type { TIconSize };
export { Icon };
