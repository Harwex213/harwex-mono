import * as React from "react"
import { Separator as Base } from "@base-ui/react/separator"
import { cn, type WithClass } from "../utils"
import styles from "./separator.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.separator, className)} {...props} />
}

export const Separator = { Root }
