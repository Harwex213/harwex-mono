import * as React from "react"
import { Accordion as Base } from "@base-ui/react/accordion"
import { cn, type WithClass } from "../utils"
import styles from "./accordion.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Item({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Item>>) {
  return <Base.Item className={cn(styles.item, className)} {...props} />
}

function Header({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Header>>) {
  return <Base.Header className={cn(styles.header, className)} {...props} />
}

function Trigger({
  className,
  children,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return (
    <Base.Trigger className={cn(styles.trigger, className)} {...props}>
      {children}
      <svg className={styles.icon} viewBox="0 0 12 12" width="12" height="12" fill="none">
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Base.Trigger>
  )
}

function Panel({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Panel>>) {
  return <Base.Panel className={cn(styles.panel, className)} {...props} />
}

export const Accordion = { Root, Item, Header, Trigger, Panel }
