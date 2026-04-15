import { type ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import s from "./button.module.css";

type TButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, TButtonProps>(
  ({ variant = "secondary", size = "md", className, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(s.button, s[variant], s[size], className)}
      {...rest}
    />
  ),
);
