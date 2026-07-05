import * as React from "react"
import { Collapsible as Base } from "@base-ui/react/collapsible"
import { cn, type WithClass } from "../utils"
import styles from "./collapsible.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Trigger({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return (
    <Base.Trigger className={cn(styles.trigger, className)} {...props}>
      <svg className={styles.icon} viewBox="0 0 12 12" width="12" height="12" fill="none">
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </Base.Trigger>
  )
}

function Panel({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Panel>>) {
  return <Base.Panel className={cn(styles.panel, className)} {...props} />
}

export const Collapsible = { Root, Trigger, Panel }
