import * as React from "react"
import { Toast as Base } from "@base-ui/react/toast"
import { cn, type WithClass } from "../utils"
import styles from "./toast.module.css"

function Provider(props: React.ComponentProps<typeof Base.Provider>) {
  return <Base.Provider {...props} />
}

function Portal(props: React.ComponentProps<typeof Base.Portal>) {
  return <Base.Portal {...props} />
}

function Viewport({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Viewport>>) {
  return <Base.Viewport className={cn(styles.viewport, className)} {...props} />
}

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Content({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Content>>) {
  return <Base.Content className={cn(styles.content, className)} {...props} />
}

function Title({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Title>>) {
  return <Base.Title className={cn(styles.title, className)} {...props} />
}

function Description({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Description>>) {
  return <Base.Description className={cn(styles.description, className)} {...props} />
}

function Action({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Action>>) {
  return <Base.Action className={cn(styles.action, className)} {...props} />
}

function Close({ className, children, ...props }: WithClass<React.ComponentProps<typeof Base.Close>>) {
  return (
    <Base.Close className={cn(styles.close, className)} {...props}>
      {children ?? (
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
          <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </Base.Close>
  )
}

function Positioner({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Positioner>>) {
  return <Base.Positioner className={cn(styles.positioner, className)} {...props} />
}

function Arrow({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Arrow>>) {
  return <Base.Arrow className={cn(styles.arrow, className)} {...props} />
}

export const Toast = {
  Provider,
  Portal,
  Viewport,
  Root,
  Content,
  Title,
  Description,
  Action,
  Close,
  Positioner,
  Arrow,
  useToastManager: Base.useToastManager,
}
