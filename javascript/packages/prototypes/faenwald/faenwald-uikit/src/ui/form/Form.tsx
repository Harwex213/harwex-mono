import * as React from "react"
import { Form as Base } from "@base-ui/react/form"
import { cn, type WithClass } from "../utils"
import styles from "./form.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.root, className)} {...props} />
}

export const Form = { Root }
