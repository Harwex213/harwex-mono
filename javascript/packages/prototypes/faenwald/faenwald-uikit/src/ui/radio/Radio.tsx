import * as React from "react"
import { Radio as Base } from "@base-ui/react/radio"
import { RadioGroup as BaseGroup } from "@base-ui/react/radio-group"
import { cn, type WithClass } from "../utils"
import styles from "./radio.module.css"

function GroupRoot({ className, ...props }: WithClass<React.ComponentProps<typeof BaseGroup>>) {
  return <BaseGroup className={cn(styles.group, className)} {...props} />
}

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Indicator({
  className,
  ...props
}: WithClass<React.ComponentProps<typeof Base.Indicator>>) {
  return <Base.Indicator className={cn(styles.indicator, className)} {...props} />
}

export const RadioGroup = { Root: GroupRoot }
export const Radio = { Root, Indicator }
