import * as React from "react"
import { OTPField as Base } from "@base-ui/react/otp-field"
import { cn, type WithClass } from "../utils"
import styles from "./otp-field.module.css"

function Root({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Root>>) {
  return <Base.Root className={cn(styles.root, className)} {...props} />
}

function Input({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Input>>) {
  return <Base.Input className={cn(styles.input, className)} {...props} />
}

function Separator({ className, ...props }: WithClass<React.ComponentProps<typeof Base.Separator>>) {
  return <Base.Separator className={cn(styles.separator, className)} {...props} />
}

export const OtpField = { Root, Input, Separator }
