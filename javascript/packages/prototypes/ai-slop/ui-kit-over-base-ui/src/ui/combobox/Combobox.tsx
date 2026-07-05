import * as React from "react"
import { Combobox as Base } from "@base-ui/react/combobox"
import { cn, type WithClass } from "../utils"
import styles from "./combobox.module.css"

function Root(props: React.ComponentProps<typeof Base.Root>) {
  return <Base.Root {...props} />
}

function Label({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Label>>) {
  return <Base.Label className={cn(styles.label, className)} {...props} />
}

function Value(props: React.ComponentProps<typeof Base.Value>) {
  return <Base.Value {...props} />
}

function InputGroup({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.InputGroup>>) {
  return <Base.InputGroup className={cn(styles.inputGroup, className)} {...props} />
}

function Input({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Input>>) {
  return <Base.Input className={cn(styles.input, className)} {...props} />
}

function Clear({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.Clear>>) {
  return (
    <Base.Clear className={cn(styles.clear, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
          <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </Base.Clear>
  )
}

function Trigger({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return (
    <Base.Trigger className={cn(styles.trigger, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Base.Trigger>
  )
}

function Icon({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Icon>>) {
  return <Base.Icon className={cn(styles.icon, className)} {...props} />
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

function Empty({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Empty>>) {
  return <Base.Empty className={cn(styles.empty, className)} {...props} />
}

function Status({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Status>>) {
  return <Base.Status className={cn(styles.status, className)} {...props} />
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

function Row({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Row>>) {
  return <Base.Row className={cn(styles.row, className)} {...props} />
}

function Collection(props: React.ComponentProps<typeof Base.Collection>) {
  return <Base.Collection {...props} />
}

function Separator({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Separator>>) {
  return <Base.Separator className={cn(styles.separator, className)} {...props} />
}

function Arrow({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return <Base.Arrow className={cn(styles.arrow, className)} {...props} />
}

function Chips({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Chips>>) {
  return <Base.Chips className={cn(styles.chips, className)} {...props} />
}

function Chip({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Chip>>) {
  return <Base.Chip className={cn(styles.chip, className)} {...props} />
}

function ChipRemove({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.ChipRemove>>) {
  return (
    <Base.ChipRemove className={cn(styles.chipRemove, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
          <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </Base.ChipRemove>
  )
}

export const Combobox = {
  Root,
  Label,
  Value,
  InputGroup,
  Input,
  Clear,
  Trigger,
  Icon,
  Portal,
  Positioner,
  Popup,
  List,
  Item,
  ItemIndicator,
  Empty,
  Status,
  Group,
  GroupLabel,
  Row,
  Collection,
  Separator,
  Arrow,
  Chips,
  Chip,
  ChipRemove,
}
