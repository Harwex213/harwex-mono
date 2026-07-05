import * as React from "react"
import { OtpField } from "./OtpField"

export const meta = { title: "OTP Field" }

const LENGTH = 6

export default function OtpFieldDemo() {
  const id = React.useId()
  return (
    <OtpField.Root id={id} length={LENGTH} defaultValue="12">
      {Array.from({ length: LENGTH }, (_, index) => (
        <OtpField.Input key={index} aria-label={`Digit ${index + 1} of ${LENGTH}`} />
      ))}
    </OtpField.Root>
  )
}
