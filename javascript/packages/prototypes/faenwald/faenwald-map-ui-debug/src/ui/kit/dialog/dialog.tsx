import { type FC, type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import s from "./dialog.module.css";

type TDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export const Dialog: FC<TDialogProps> = ({ open, onOpenChange, children }) => (
  <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={s.overlay} />
      <RadixDialog.Content className={s.content}>
        {children}
        <RadixDialog.Close asChild>
          <button className={s.close} aria-label="Close">&#10005;</button>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
);

export const DialogTitle: FC<{ children: ReactNode }> = ({ children }) => (
  <RadixDialog.Title className={s.title}>{children}</RadixDialog.Title>
);
