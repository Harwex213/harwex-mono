import * as React from "react"
import { NumberField as Base } from "@base-ui/react/number-field"
import { cn, type WithClass } from "../utils"
import styles from "./number-field.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Group({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Group>>) {
  return <Base.Group className={cn(styles.group, className)} {...props} />
}

function Input({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Input>>) {
  return <Base.Input className={cn(styles.input, className)} {...props} />
}

function Decrement({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Decrement>>) {
  return (
    <Base.Decrement className={cn(styles.button, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3.5 8h9" />
        </svg>
      )}
    </Base.Decrement>
  )
}

function Increment({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Increment>>) {
  return (
    <Base.Increment className={cn(styles.button, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      )}
    </Base.Increment>
  )
}

function ScrubArea({ className, ...props }: WithClass<React.ComponentProps<typeof Base.ScrubArea>>) {
  return <Base.ScrubArea className={cn(styles.scrubArea, className)} {...props} />
}

function ScrubAreaCursor({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.ScrubAreaCursor>>) {
  return <Base.ScrubAreaCursor className={cn(styles.scrubCursor, className)} {...props} />
}

export const NumberField = {
  Root,
  Group,
  Input,
  Decrement,
  Increment,
  ScrubArea,
  ScrubAreaCursor,
}
