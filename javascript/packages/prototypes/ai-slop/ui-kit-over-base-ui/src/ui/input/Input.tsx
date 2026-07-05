import * as React from "react"
import { Input as Base } from "@base-ui/react/input"
import { cn, type WithClass } from "../utils"
import styles from "./input.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.input, className)} {...props} />
}

export const Input = { Root }
