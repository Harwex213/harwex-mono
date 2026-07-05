import * as React from "react"
import { Avatar as Base } from "@base-ui/react/avatar"
import { cn, type WithClass } from "../utils"
import styles from "./avatar.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Image({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Image>>) {
  return <Base.Image className={cn(styles.image, className)} {...props} />
}

function Fallback({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Fallback>>) {
  return <Base.Fallback className={cn(styles.fallback, className)} {...props} />
}

export const Avatar = { Root, Image, Fallback }
