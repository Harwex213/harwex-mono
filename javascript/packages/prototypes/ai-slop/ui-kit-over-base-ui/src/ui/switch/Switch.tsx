import * as React from "react"
import { Switch as Base } from "@base-ui/react/switch"
import { cn, type WithClass } from "../utils"
import styles from "./switch.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Thumb({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Thumb>>) {
  return <Base.Thumb className={cn(styles.thumb, className)} {...props} />
}

export const Switch = { Root, Thumb }
