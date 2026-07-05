import * as React from "react"
import { Button as Base } from "@base-ui/react/button"
import { cn, type WithClass } from "../utils"
import styles from "./button.module.css"

type Variant = "primary" | "secondary" | "ghost" | "danger"
type Size = "sm" | "md" | "lg"

type ButtonProps = WithClass<React.ComponentProps<typeof Base>> & {
  variant?: Variant
  size?: Size
}

function Root({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <Base
      className={cn(styles.button, styles[variant], styles[size], className)}
      {...props}
    />
  )
}

export const Button = { Root }
