import * as React from "react"
import { Popover as Base } from "@base-ui/react/popover"
import { cn, type WithClass } from "../utils"
import styles from "./popover.module.css"

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

function Positioner({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Positioner>>) {
  return <Base.Positioner className={cn(styles.positioner, className)} {...props} />
}

function Popup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup className={cn(styles.popup, className)} {...props} />
}

function Arrow({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return (
    <Base.Arrow className={cn(styles.arrow, className)} {...props}>
      {children ?? (
        <svg className={styles.arrowSvg} viewBox="0 0 20 10" width="20" height="10">
          <polygon className={styles.arrowFill} points="10,0 20,10 0,10" />
          <path className={styles.arrowStroke} d="M0 10 L10 0 L20 10" fill="none" />
        </svg>
      )}
    </Base.Arrow>
  )
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

export const Popover = {
  Root,
  Trigger,
  Portal,
  Backdrop,
  Positioner,
  Popup,
  Arrow,
  Title,
  Description,
  Close,
}
