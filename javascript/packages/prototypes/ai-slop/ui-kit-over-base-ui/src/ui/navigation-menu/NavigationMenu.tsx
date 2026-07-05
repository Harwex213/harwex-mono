import * as React from "react"
import { NavigationMenu as Base } from "@base-ui/react/navigation-menu"
import { cn, type WithClass } from "../utils"
import styles from "./navigation-menu.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function List({ className, ...props }: WithClass<React.ComponentProps<typeof Base.List>>) {
  return <Base.List className={cn(styles.list, className)} {...props} />
}

function Item({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Item>>) {
  return <Base.Item className={cn(styles.item, className)} {...props} />
}

function Trigger({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return (
    <Base.Trigger className={cn(styles.trigger, className)} {...props}>
      {children}
      <Base.Icon className={styles.icon}>
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Base.Icon>
    </Base.Trigger>
  )
}

function Icon({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Icon>>) {
  return <Base.Icon className={cn(styles.icon, className)} {...props} />
}

function Content({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Content>>) {
  return <Base.Content className={cn(styles.content, className)} {...props} />
}

function Link({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Link>>) {
  return <Base.Link className={cn(styles.link, className)} {...props} />
}

function Portal(props: React.ComponentProps<typeof Base.Portal>) {
  return <Base.Portal {...props} />
}

function Backdrop({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Backdrop>>) {
  return <Base.Backdrop className={cn(styles.backdrop, className)} {...props} />
}

function Positioner({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Positioner>>) {
  return <Base.Positioner className={cn(styles.positioner, className)} sideOffset={props.sideOffset ?? 8} {...props} />
}

function Popup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup className={cn(styles.popup, className)} {...props} />
}

function Viewport({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Viewport>>) {
  return <Base.Viewport className={cn(styles.viewport, className)} {...props} />
}

function Arrow({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return (
    <Base.Arrow className={cn(styles.arrow, className)} {...props}>
      <svg viewBox="0 0 20 10" width="20" height="10">
        <path d="M0 10 L10 0 L20 10 Z" fill="var(--uk-panel-elevated)" />
        <path d="M0 10 L10 0 L20 10" fill="none" stroke="var(--uk-border)" strokeWidth="1" />
      </svg>
    </Base.Arrow>
  )
}

export const NavigationMenu = {
  Root,
  List,
  Item,
  Trigger,
  Icon,
  Content,
  Link,
  Portal,
  Backdrop,
  Positioner,
  Popup,
  Viewport,
  Arrow,
}
