import { Progress } from "./Progress"

export const meta = { title: "Progress" }

export default function ProgressDemo() {
  return (
    <Progress.Root value={60}>
      <Progress.Label>Uploading files</Progress.Label>
      <Progress.Value />
      <Progress.Track>
        <Progress.Indicator />
      </Progress.Track>
    </Progress.Root>
  )
}
