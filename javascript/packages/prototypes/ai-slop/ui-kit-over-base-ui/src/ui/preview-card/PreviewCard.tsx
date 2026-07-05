import * as React from "react"
import { PreviewCard as Base } from "@base-ui/react/preview-card"
import { cn, type WithClass } from "../utils"
import styles from "./preview-card.module.css"

function Root(props: React.ComponentProps<typeof Base.Root>) {
  return <Base.Root {...props} />
}

function Trigger({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Trigger>>) {
  return <Base.Trigger className={cn(styles.trigger, className)} {...props} />
}

function Portal(props: React.ComponentProps<typeof Base.Portal>) {
  return <Base.Portal {...props} />
}

function Positioner({
  className,
  sideOffset = 8,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Positioner>>) {
  return (
    <Base.Positioner
      className={cn(styles.positioner, className)}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function Popup({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Popup>>) {
  return <Base.Popup className={cn(styles.popup, className)} {...props} />
}

function Arrow({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return (
    <Base.Arrow className={cn(styles.arrow, className)} {...props}>
      <svg className={styles.arrowSvg} viewBox="0 0 12 12" width="12" height="12">
        <path className={styles.arrowFill} d="M6 10 0 4h12z" />
        <path className={styles.arrowStroke} d="M6 10 0 4M6 10l6-6" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </Base.Arrow>
  )
}

export const PreviewCard = { Root, Trigger, Portal, Positioner, Popup, Arrow }
