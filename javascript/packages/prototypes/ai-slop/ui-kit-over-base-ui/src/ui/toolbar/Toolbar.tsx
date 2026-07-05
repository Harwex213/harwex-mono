import * as React from "react"
import { Toolbar as Base } from "@base-ui/react/toolbar"
import { cn, type WithClass } from "../utils"
import styles from "./toolbar.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Button({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Button>>) {
  return <Base.Button className={cn(styles.button, className)} {...props} />
}

function Link({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Link>>) {
  return <Base.Link className={cn(styles.link, className)} {...props} />
}

function Separator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Separator>>) {
  return <Base.Separator className={cn(styles.separator, className)} {...props} />
}

function Group({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Group>>) {
  return <Base.Group className={cn(styles.group, className)} {...props} />
}

function Input({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Input>>) {
  return <Base.Input className={cn(styles.input, className)} {...props} />
}

export const Toolbar = { Root, Button, Link, Separator, Group, Input }
