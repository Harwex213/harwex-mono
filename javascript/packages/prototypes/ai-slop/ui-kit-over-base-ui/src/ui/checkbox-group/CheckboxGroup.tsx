import * as React from "react"
import { CheckboxGroup as Base } from "@base-ui/react/checkbox-group"
import { cn, type WithClass } from "../utils"
import styles from "./checkbox-group.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.root, className)} {...props} />
}

export const CheckboxGroup = { Root }
