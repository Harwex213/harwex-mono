import * as React from "react"
import { Field as Base } from "@base-ui/react/field"
import { cn, type WithClass } from "../utils"
import styles from "./field.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Item({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Item>>) {
  return <Base.Item className={cn(styles.item, className)} {...props} />
}

function Label({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Label>>) {
  return <Base.Label className={cn(styles.label, className)} {...props} />
}

function Control({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Control>>) {
  return <Base.Control className={cn(styles.control, className)} {...props} />
}

function Description({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Description>>) {
  return <Base.Description className={cn(styles.description, className)} {...props} />
}

function Error({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Error>>) {
  return <Base.Error className={cn(styles.error, className)} {...props} />
}

const Validity = Base.Validity

export const Field = { Root, Item, Label, Control, Description, Error, Validity }
