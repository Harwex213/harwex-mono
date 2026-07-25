import { Slider } from "./Slider"

export const meta = { title: "Slider" }

export default function SliderDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <Slider.Root defaultValue={40} min={0} max={100}>
        <Slider.Label>Volume</Slider.Label>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb aria-label="Volume" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>

      <Slider.Root defaultValue={[25, 75]} min={0} max={100}>
        <Slider.Label>Price range</Slider.Label>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb index={0} aria-label="Minimum price" />
            <Slider.Thumb index={1} aria-label="Maximum price" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  )
}
