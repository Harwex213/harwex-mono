import * as React from "react"
import { Menubar as Base } from "@base-ui/react/menubar"
import { cn, type WithClass } from "../utils"
import styles from "./menubar.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base>>) {
  return <Base className={cn(styles.root, className)} {...props} />
}

export const Menubar = { Root }
