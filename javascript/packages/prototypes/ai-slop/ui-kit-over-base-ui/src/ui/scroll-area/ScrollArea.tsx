import * as React from "react"
import { ScrollArea as Base } from "@base-ui/react/scroll-area"
import { cn, type WithClass } from "../utils"
import styles from "./scroll-area.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Viewport({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Viewport>>) {
  return <Base.Viewport className={cn(styles.viewport, className)} {...props} />
}

function Content({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Content>>) {
  return <Base.Content className={cn(styles.content, className)} {...props} />
}

function Scrollbar({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Scrollbar>>) {
  return <Base.Scrollbar className={cn(styles.scrollbar, className)} {...props} />
}

function Thumb({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Thumb>>) {
  return <Base.Thumb className={cn(styles.thumb, className)} {...props} />
}

function Corner({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Corner>>) {
  return <Base.Corner className={cn(styles.corner, className)} {...props} />
}

export const ScrollArea = { Root, Viewport, Content, Scrollbar, Thumb, Corner }
