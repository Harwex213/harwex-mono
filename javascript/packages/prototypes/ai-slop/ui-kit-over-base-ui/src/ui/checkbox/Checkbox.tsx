import * as React from "react"
import { Checkbox as Base } from "@base-ui/react/checkbox"
import { cn, type WithClass } from "../utils"
import styles from "./checkbox.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Indicator({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Indicator>>) {
  return (
    <Base.Indicator className={cn(styles.indicator, className)} {...props}>
      {children ?? (
        <svg
          className={styles.icon}
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
        >
          <path
            d="m2.5 8.5 4 4 7-9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Base.Indicator>
  )
}

export const Checkbox = { Root, Indicator }
