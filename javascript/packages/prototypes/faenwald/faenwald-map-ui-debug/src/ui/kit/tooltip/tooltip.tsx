import { type FC, type ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import s from "./tooltip.module.css";

type TTooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
};

export const TooltipProvider = RadixTooltip.Provider;

export const Tooltip: FC<TTooltipProps> = ({ content, children, side = "top", delayDuration = 300 }) => (
  <RadixTooltip.Root delayDuration={delayDuration}>
    <RadixTooltip.Trigger asChild>
      {children}
    </RadixTooltip.Trigger>
    <RadixTooltip.Portal>
      <RadixTooltip.Content className={s.content} side={side} sideOffset={6}>
        {content}
        <RadixTooltip.Arrow className={s.arrow} width={10} height={5} />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  </RadixTooltip.Root>
);
