import { TProvincesMap } from "./map.ts";
import { getPixelHex } from "./utils.ts";

const BORDER_HALF_WIDTH = 1 // results in 5px wide borders (1 + 2*2)

export function detectBorders(
  imageData: ImageData,
  provincesMap: TProvincesMap,
): { canvas: OffscreenCanvas; dilatedMask: Uint8Array } {
  const { data, width, height } = imageData
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const borderData = ctx.createImageData(width, height)
  const bd = borderData.data

  // Pass 1: mark raw border pixels using 8-connectivity
  const isBorderPixel = new Uint8Array(width * height)
  const DIRS = [-1, 0, 1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = getPixelHex(data, x, y, width)
      if (color === '#ffffff' || !(color in provincesMap)) continue

      let border = false
      outer: for (const dy of DIRS) {
        for (const dx of DIRS) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            border = true
            break outer
          }
          const neighborColor = getPixelHex(data, nx, ny, width)
          if (neighborColor !== color) {
            border = true
            break outer
          }
        }
      }

      if (border) isBorderPixel[y * width + x] = 1
    }
  }

  // Pass 2: dilate border pixels by BORDER_HALF_WIDTH
  const dilatedMask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isBorderPixel[y * width + x]) continue
      for (let dy = -BORDER_HALF_WIDTH; dy <= BORDER_HALF_WIDTH; dy++) {
        for (let dx = -BORDER_HALF_WIDTH; dx <= BORDER_HALF_WIDTH; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const i = (ny * width + nx) * 4
          bd[i] = 0
          bd[i + 1] = 0
          bd[i + 2] = 0
          bd[i + 3] = 217
          dilatedMask[ny * width + nx] = 1
        }
      }
    }
  }

  ctx.putImageData(borderData, 0, 0)
  return { canvas, dilatedMask }
}
