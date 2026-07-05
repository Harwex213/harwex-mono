import * as React from "react"
import { Fieldset as Base } from "@base-ui/react/fieldset"
import { cn, type WithClass } from "../utils"
import styles from "./fieldset.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Legend({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Legend>>) {
  return <Base.Legend className={cn(styles.legend, className)} {...props} />
}

export const Fieldset = { Root, Legend }
