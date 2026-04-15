import { type HTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import s from "./scroll-area.module.css";

type TScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  direction?: "horizontal" | "vertical";
};

export const ScrollArea = forwardRef<HTMLDivElement, TScrollAreaProps>(
  ({ direction, className, ...rest }, ref) => (
    <div ref={ref} className={clsx(s.scrollArea, direction && s[direction], className)} {...rest} />
  ),
);
