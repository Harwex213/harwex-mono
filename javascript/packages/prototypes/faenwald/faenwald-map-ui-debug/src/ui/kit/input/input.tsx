import { type InputHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import s from "./input.module.css";

type TInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const Input = forwardRef<HTMLInputElement, TInputProps>(
  ({ label, className, id, ...rest }, ref) => (
    <div className={clsx(s.wrapper, className)}>
      {label ? <label className={s.label} htmlFor={id}>{label}</label> : null}
      <input ref={ref} id={id} className={s.input} {...rest} />
    </div>
  ),
);
