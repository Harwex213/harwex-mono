import { type FC, type ReactNode } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import s from "./popover.module.css";

type TPopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
};

export const Popover: FC<TPopoverProps> = ({ trigger, children, side = "bottom" }) => (
  <RadixPopover.Root>
    <RadixPopover.Trigger asChild>
      {trigger}
    </RadixPopover.Trigger>
    <RadixPopover.Portal>
      <RadixPopover.Content className={s.content} side={side} sideOffset={6}>
        {children}
        <RadixPopover.Arrow className={s.arrow} width={10} height={5} />
        <RadixPopover.Close asChild>
          <button className={s.close} aria-label="Close">&#10005;</button>
        </RadixPopover.Close>
      </RadixPopover.Content>
    </RadixPopover.Portal>
  </RadixPopover.Root>
);
