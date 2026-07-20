import * as React from "react"
import { Tabs as Base } from "@base-ui/react/tabs"
import { cn, type WithClass } from "../utils"
import styles from "./tabs.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function List({ className, ...props }: WithClass<React.ComponentProps<typeof Base.List>>) {
  return <Base.List className={cn(styles.list, className)} {...props} />
}

function Tab({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Tab>>) {
  return <Base.Tab className={cn(styles.tab, className)} {...props} />
}

function Indicator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Indicator>>) {
  return <Base.Indicator className={cn(styles.indicator, className)} {...props} />
}

function Panel({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Panel>>) {
  return <Base.Panel className={cn(styles.panel, className)} {...props} />
}

export const Tabs = { Root, List, Tab, Indicator, Panel }
