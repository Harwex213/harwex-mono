import * as React from "react"
import { Toggle as Base } from "@base-ui/react/toggle"
import { cn, type WithClass } from "../utils"
import styles from "./toggle.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.root, className)} {...props} />
}

export const Toggle = { Root }
