import * as React from "react"
import { Drawer as Base } from "@base-ui/react/drawer"
import { cn, type WithClass } from "../utils"
import styles from "./drawer.module.css"

function Root(props: React.ComponentProps<typeof Base.Root>) {
  return <Base.Root {...props} />
}

function Trigger({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return <Base.Trigger className={cn(styles.trigger, className)} {...props} />
}

function Portal(props: React.ComponentProps<typeof Base.Portal>) {
  return <Base.Portal {...props} />
}

function Backdrop({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Backdrop>>) {
  return <Base.Backdrop className={cn(styles.backdrop, className)} {...props} />
}

function Viewport({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Viewport>>) {
  return <Base.Viewport className={cn(styles.viewport, className)} {...props} />
}

function Popup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup className={cn(styles.popup, className)} {...props} />
}

function Content({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Content>>) {
  return <Base.Content className={cn(styles.content, className)} {...props} />
}

function Title({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Title>>) {
  return <Base.Title className={cn(styles.title, className)} {...props} />
}

function Description({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Description>>) {
  return <Base.Description className={cn(styles.description, className)} {...props} />
}

function Close({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Close>>) {
  return <Base.Close className={cn(styles.close, className)} {...props} />
}

export const Drawer = {
  Root,
  Trigger,
  Portal,
  Backdrop,
  Viewport,
  Popup,
  Content,
  Title,
  Description,
  Close,
}
