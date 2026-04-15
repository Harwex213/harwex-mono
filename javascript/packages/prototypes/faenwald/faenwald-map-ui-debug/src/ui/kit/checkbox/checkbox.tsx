import { type ChangeEventHandler, type FC } from "react";
import clsx from "clsx";
import s from "./checkbox.module.css";

type TCheckboxProps = {
  label?: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  id?: string;
  className?: string;
};

export const Checkbox: FC<TCheckboxProps> = ({ label, checked, onChange, id, className }) => (
  <label className={clsx(s.wrapper, className)} htmlFor={id}>
    <input type="checkbox" id={id} checked={checked} onChange={onChange} className={s.hidden} />
    <span className={clsx(s.box, checked && s.checked)}>
      <span className={s.checkmark}>&#10003;</span>
    </span>
    {label ? <span className={s.label}>{label}</span> : null}
  </label>
);
