import { type FC } from "react";
import * as RadixSelect from "@radix-ui/react-select";
import clsx from "clsx";
import s from "./select.module.css";

type TSelectOption = {
  value: string;
  label: string;
};

type TSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: TSelectOption[];
  placeholder?: string;
  className?: string;
};

export const Select: FC<TSelectProps> = ({ value, onValueChange, options, placeholder, className }) => (
  <RadixSelect.Root value={value} onValueChange={onValueChange}>
    <RadixSelect.Trigger className={clsx(s.trigger, className)}>
      <RadixSelect.Value placeholder={placeholder} />
      <RadixSelect.Icon className={s.icon}>&#9662;</RadixSelect.Icon>
    </RadixSelect.Trigger>

    <RadixSelect.Portal>
      <RadixSelect.Content className={s.content} position="popper" sideOffset={4}>
        <RadixSelect.Viewport className={s.viewport}>
          {options.map((option) => (
            <RadixSelect.Item key={option.value} value={option.value} className={s.item}>
              <RadixSelect.ItemIndicator className={s.indicator}>&#10003;</RadixSelect.ItemIndicator>
              <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
            </RadixSelect.Item>
          ))}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>
);
