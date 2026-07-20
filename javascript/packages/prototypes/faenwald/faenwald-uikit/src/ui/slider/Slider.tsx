import * as React from "react"
import { Slider as Base } from "@base-ui/react/slider"
import { cn, type WithClass } from "../utils"
import styles from "./slider.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Label({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Label>>) {
  return <Base.Label className={cn(styles.label, className)} {...props} />
}

function Value({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Value>>) {
  return <Base.Value className={cn(styles.value, className)} {...props} />
}

function Control({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Control>>) {
  return <Base.Control className={cn(styles.control, className)} {...props} />
}

function Track({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Track>>) {
  return <Base.Track className={cn(styles.track, className)} {...props} />
}

function Indicator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Indicator>>) {
  return <Base.Indicator className={cn(styles.indicator, className)} {...props} />
}

function Thumb({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Thumb>>) {
  return <Base.Thumb className={cn(styles.thumb, className)} {...props} />
}

export const Slider = { Root, Label, Value, Control, Track, Indicator, Thumb }
