import * as React from "react"
import { Menu as Base } from "@base-ui/react/menu"
import { cn, type WithClass } from "../utils"
import styles from "./menu.module.css"

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
      <path d="M2.5 7.5 6 11l5.5-7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DotIcon() {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor">
      <circle cx="7" cy="7" r="3" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg className={styles.submenuIcon} viewBox="0 0 12 12" width="12" height="12" fill="none">
      <path d="M4.5 3 7.5 6 4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Root(props: React.ComponentProps<typeof Base.Root>) {
  return <Base.Root {...props} />
}

function Trigger({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return <Base.Trigger className={cn(styles.trigger, className)} {...props} />
}

function Portal(props: React.ComponentProps<typeof Base.Portal>) {
  return <Base.Portal {...props} />
}

function Backdrop({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Backdrop>>) {
  return <Base.Backdrop className={cn(styles.backdrop, className)} {...props} />
}

function Positioner({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Positioner>>) {
  return <Base.Positioner className={cn(styles.positioner, className)} sideOffset={props.sideOffset ?? 6} {...props} />
}

function Popup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup className={cn(styles.popup, className)} {...props} />
}

function Arrow({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return (
    <Base.Arrow className={cn(styles.arrow, className)} {...props}>
      <svg viewBox="0 0 20 10" width="20" height="10">
        <path d="M0 10 L10 0 L20 10 Z" fill="var(--uk-panel-elevated)" />
        <path d="M0 10 L10 0 L20 10" fill="none" stroke="var(--uk-border)" strokeWidth="1" />
      </svg>
    </Base.Arrow>
  )
}

function Item({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Item>>) {
  return <Base.Item className={cn(styles.item, className)} {...props} />
}

function LinkItem({ className, ...props }: WithClass<React.ComponentProps<typeof Base.LinkItem>>) {
  return <Base.LinkItem className={cn(styles.item, className)} {...props} />
}

function Separator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Separator>>) {
  return <Base.Separator className={cn(styles.separator, className)} {...props} />
}

function Group({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Group>>) {
  return <Base.Group className={cn(styles.group, className)} {...props} />
}

function GroupLabel({ className, ...props }: WithClass<React.ComponentProps<typeof Base.GroupLabel>>) {
  return <Base.GroupLabel className={cn(styles.groupLabel, className)} {...props} />
}

function RadioGroup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.RadioGroup>>) {
  return <Base.RadioGroup className={cn(styles.radioGroup, className)} {...props} />
}

function RadioItem({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.RadioItem>>) {
  return (
    <Base.RadioItem className={cn(styles.item, styles.itemIndicated, className)} {...props}>
      <span className={styles.indicator}>
        <Base.RadioItemIndicator className={styles.indicatorInner}>
          <DotIcon />
        </Base.RadioItemIndicator>
      </span>
      <span className={styles.itemLabel}>{children}</span>
    </Base.RadioItem>
  )
}

function RadioItemIndicator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.RadioItemIndicator>>) {
  return <Base.RadioItemIndicator className={cn(styles.indicatorInner, className)} {...props} />
}

function CheckboxItem({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.CheckboxItem>>) {
  return (
    <Base.CheckboxItem className={cn(styles.item, styles.itemIndicated, className)} {...props}>
      <span className={styles.indicator}>
        <Base.CheckboxItemIndicator className={styles.indicatorInner}>
          <CheckIcon />
        </Base.CheckboxItemIndicator>
      </span>
      <span className={styles.itemLabel}>{children}</span>
    </Base.CheckboxItem>
  )
}

function CheckboxItemIndicator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.CheckboxItemIndicator>>) {
  return <Base.CheckboxItemIndicator className={cn(styles.indicatorInner, className)} {...props} />
}

function SubmenuRoot(props: React.ComponentProps<typeof Base.SubmenuRoot>) {
  return <Base.SubmenuRoot {...props} />
}

function SubmenuTrigger({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.SubmenuTrigger>>) {
  return (
    <Base.SubmenuTrigger className={cn(styles.item, styles.submenuTrigger, className)} {...props}>
      <span className={styles.itemLabel}>{children}</span>
      <ChevronRight />
    </Base.SubmenuTrigger>
  )
}

function Viewport({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Viewport>>) {
  return <Base.Viewport className={cn(styles.viewport, className)} {...props} />
}

export const Menu = {
  Root,
  Trigger,
  Portal,
  Backdrop,
  Positioner,
  Popup,
  Arrow,
  Item,
  LinkItem,
  Separator,
  Group,
  GroupLabel,
  RadioGroup,
  RadioItem,
  RadioItemIndicator,
  CheckboxItem,
  CheckboxItemIndicator,
  SubmenuRoot,
  SubmenuTrigger,
  Viewport,
}
