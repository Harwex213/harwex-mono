import { type HTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import s from "./card.module.css";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div ref={ref} className={clsx(s.card, className)} {...rest} />
  ),
);
