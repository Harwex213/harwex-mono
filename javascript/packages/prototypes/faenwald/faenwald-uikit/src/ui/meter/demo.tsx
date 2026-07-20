import { Meter } from "./Meter"

export const meta = { title: "Meter" }

export default function MeterDemo() {
  return (
    <Meter.Root value={72}>
      <Meter.Label>Storage used</Meter.Label>
      <Meter.Value />
      <Meter.Track>
        <Meter.Indicator />
      </Meter.Track>
    </Meter.Root>
  )
}
