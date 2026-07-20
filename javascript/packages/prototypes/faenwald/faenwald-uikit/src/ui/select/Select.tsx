import * as React from "react"
import { Select as Base } from "@base-ui/react/select"
import { cn, type WithClass } from "../utils"
import styles from "./select.module.css"

function Root(props: React.ComponentProps<typeof Base.Root>) {
  return <Base.Root {...props} />
}

function Label({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Label>>) {
  return <Base.Label className={cn(styles.label, className)} {...props} />
}

function Trigger({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return (
    <Base.Trigger className={cn(styles.trigger, className)} {...props}>
      {children}
    </Base.Trigger>
  )
}

function Value({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Value>>) {
  return <Base.Value className={cn(styles.value, className)} {...props} />
}

function Icon({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.Icon>>) {
  return (
    <Base.Icon className={cn(styles.icon, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M4 4.5 6 2.5 8 4.5M4 7.5 6 9.5 8 7.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Base.Icon>
  )
}

function Portal(props: React.ComponentProps<typeof Base.Portal>) {
  return <Base.Portal {...props} />
}

function Positioner({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Positioner>>) {
  return <Base.Positioner className={cn(styles.positioner, className)} sideOffset={props.sideOffset ?? 6} {...props} />
}

function Popup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup className={cn(styles.popup, className)} {...props} />
}

function List({ className, ...props }: WithClass<React.ComponentProps<typeof Base.List>>) {
  return <Base.List className={cn(styles.list, className)} {...props} />
}

function Item({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Item>>) {
  return <Base.Item className={cn(styles.item, className)} {...props} />
}

function ItemText({ className, ...props }: WithClass<React.ComponentProps<typeof Base.ItemText>>) {
  return <Base.ItemText className={cn(styles.itemText, className)} {...props} />
}

function ItemIndicator({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.ItemIndicator>>) {
  return (
    <Base.ItemIndicator className={cn(styles.itemIndicator, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
          <path d="M2.5 7.5 6 11l5.5-7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Base.ItemIndicator>
  )
}

function Group({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Group>>) {
  return <Base.Group className={cn(styles.group, className)} {...props} />
}

function GroupLabel({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.GroupLabel>>) {
  return <Base.GroupLabel className={cn(styles.groupLabel, className)} {...props} />
}

function Separator({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Separator>>) {
  return <Base.Separator className={cn(styles.separator, className)} {...props} />
}

function ScrollUpArrow({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.ScrollUpArrow>>) {
  return (
    <Base.ScrollUpArrow className={cn(styles.scrollArrow, styles.scrollUp, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M3 7.5 6 4.5 9 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Base.ScrollUpArrow>
  )
}

function ScrollDownArrow({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.ScrollDownArrow>>) {
  return (
    <Base.ScrollDownArrow className={cn(styles.scrollArrow, styles.scrollDown, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Base.ScrollDownArrow>
  )
}

function Arrow({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return <Base.Arrow className={cn(styles.arrow, className)} {...props} />
}

export const Select = {
  Root,
  Label,
  Trigger,
  Value,
  Icon,
  Portal,
  Positioner,
  Popup,
  List,
  Item,
  ItemText,
  ItemIndicator,
  Group,
  GroupLabel,
  Separator,
  ScrollUpArrow,
  ScrollDownArrow,
  Arrow,
}
