import { type ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import s from "./icon-button.module.css";

type TIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md";
};

export const IconButton = forwardRef<HTMLButtonElement, TIconButtonProps>(
  ({ size = "sm", className, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(s.iconButton, s[size], className)}
      {...rest}
    />
  ),
);
