import * as React from "react"
import { ToggleGroup as Base } from "@base-ui/react/toggle-group"
import { cn, type WithClass } from "../utils"
import styles from "./toggle-group.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.root, className)} {...props} />
}

export const ToggleGroup = { Root }
