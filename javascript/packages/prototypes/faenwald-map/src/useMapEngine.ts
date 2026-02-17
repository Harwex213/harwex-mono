import { RefObject, useEffect, useRef, useState } from 'react'
import { MapState, Province, ProvincesMap } from './types'

const ZOOM_FACTOR = 1.1

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function loadProvinces(): Promise<ProvincesMap> {
  const res = await fetch('/assets/provinces.json')
  return res.json()
}

function getPixelHex(data: Uint8ClampedArray, x: number, y: number, width: number): string {
  const i = (y * width + x) * 4
  const r = data[i].toString(16).padStart(2, '0')
  const g = data[i + 1].toString(16).padStart(2, '0')
  const b = data[i + 2].toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

const BORDER_HALF_WIDTH = 1 // results in 5px wide borders (1 + 2*2)

function detectBorders(
  imageData: ImageData,
  provincesMap: ProvincesMap,
): OffscreenCanvas {
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
        }
      }
    }
  }

  ctx.putImageData(borderData, 0, 0)
  return canvas
}

function buildHighlight(imageData: ImageData, color: string): OffscreenCanvas {
  const { data, width, height } = imageData
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const hlData = ctx.createImageData(width, height)
  const hd = hlData.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (getPixelHex(data, x, y, width) === color) {
        const i = (y * width + x) * 4
        hd[i] = 255
        hd[i + 1] = 220
        hd[i + 2] = 80
        hd[i + 3] = 89 // ~0.35 opacity
      }
    }
  }

  ctx.putImageData(hlData, 0, 0)
  return canvas
}

function getCanvasCoords(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  }
}

export function useMapEngine(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [selectedProvince, setSelectedProvince] = useState<Province | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const stateRef = useRef<MapState>({ offsetX: 0, offsetY: 0, scale: 1 })
  const assetsRef = useRef<{
    baseImg: HTMLImageElement
    provincesImageData: ImageData
    provincesMap: ProvincesMap
    borderCanvas: OffscreenCanvas
    highlightCanvas: OffscreenCanvas | null
    selectedColor: string | null
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let rafId = 0
    let isDragging = false
    let hasDragged = false
    let lastX = 0
    let lastY = 0

    function syncCanvasSize() {
      canvas!.width = canvas!.clientWidth
      canvas!.height = canvas!.clientHeight
    }

    function initScale(imgWidth: number, imgHeight: number) {
      const scaleX = canvas!.width / imgWidth
      const scaleY = canvas!.height / imgHeight
      const scale = Math.min(scaleX, scaleY)
      stateRef.current.scale = scale
      stateRef.current.offsetX = (canvas!.width - imgWidth * scale) / 2
      stateRef.current.offsetY = (canvas!.height - imgHeight * scale) / 2
    }

    function renderFrame() {
      const ctx = canvas!.getContext('2d')
      if (!ctx || !assetsRef.current) {
        rafId = requestAnimationFrame(renderFrame)
        return
      }

      const { baseImg, borderCanvas, highlightCanvas } = assetsRef.current
      const { offsetX, offsetY, scale } = stateRef.current

      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvas!.width, canvas!.height)
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
      ctx.drawImage(baseImg, 0, 0)
      ctx.drawImage(borderCanvas, 0, 0)
      if (highlightCanvas) {
        ctx.drawImage(highlightCanvas, 0, 0)
      }
      ctx.restore()

      rafId = requestAnimationFrame(renderFrame)
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const assets = assetsRef.current
      if (!assets) return

      const { x, y } = getCanvasCoords(canvas!, e.clientX, e.clientY)
      const state = stateRef.current
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR

      const minScale = Math.min(
        canvas!.width / assets.baseImg.naturalWidth,
        canvas!.height / assets.baseImg.naturalHeight,
      ) * 0.5

      const newScale = Math.min(8, Math.max(minScale, state.scale * factor))
      const worldX = (x - state.offsetX) / state.scale
      const worldY = (y - state.offsetY) / state.scale

      state.scale = newScale
      state.offsetX = x - worldX * newScale
      state.offsetY = y - worldY * newScale
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return
      isDragging = true
      hasDragged = false
      lastX = e.clientX
      lastY = e.clientY
      canvas!.style.cursor = 'grabbing'
    }

    function onMouseMove(e: MouseEvent) {
      if (!isDragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true
      lastX = e.clientX
      lastY = e.clientY
      stateRef.current.offsetX += dx
      stateRef.current.offsetY += dy
    }

    function stopDrag() {
      isDragging = false
      canvas!.style.cursor = 'grab'
    }

    function onClick(e: MouseEvent) {
      if (hasDragged || !assetsRef.current) return
      const { provincesImageData, provincesMap } = assetsRef.current
      const { x, y } = getCanvasCoords(canvas!, e.clientX, e.clientY)
      const state = stateRef.current

      const imgX = Math.round((x - state.offsetX) / state.scale)
      const imgY = Math.round((y - state.offsetY) / state.scale)

      const { width, height } = provincesImageData
      if (imgX < 0 || imgY < 0 || imgX >= width || imgY >= height) {
        assetsRef.current.highlightCanvas = null
        assetsRef.current.selectedColor = null
        setSelectedProvince(null)
        return
      }

      const color = getPixelHex(provincesImageData.data, imgX, imgY, width)
      const province = provincesMap[color]

      if (!province || color === '#ffffff') {
        assetsRef.current.highlightCanvas = null
        assetsRef.current.selectedColor = null
        setSelectedProvince(null)
        return
      }

      if (assetsRef.current.selectedColor !== color) {
        assetsRef.current.highlightCanvas = buildHighlight(provincesImageData, color)
        assetsRef.current.selectedColor = color
      }

      setSelectedProvince(province)
    }

    const resizeObserver = new ResizeObserver(() => {
      syncCanvasSize()
      if (assetsRef.current) {
        initScale(assetsRef.current.baseImg.naturalWidth, assetsRef.current.baseImg.naturalHeight)
      }
    })

    syncCanvasSize()
    resizeObserver.observe(canvas)

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopDrag)
    canvas.addEventListener('mouseleave', stopDrag)
    canvas.addEventListener('click', onClick)

    rafId = requestAnimationFrame(renderFrame)

    Promise.all([
      loadImage('/assets/map_base.jpg'),
      loadImage('/assets/map_provinces.png'),
      loadProvinces(),
    ]).then(([baseImg, provincesImg, provincesMap]) => {
      const offscreen = new OffscreenCanvas(provincesImg.naturalWidth, provincesImg.naturalHeight)
      const offCtx = offscreen.getContext('2d')!
      offCtx.drawImage(provincesImg, 0, 0)
      const provincesImageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height)

      const borderCanvas = detectBorders(provincesImageData, provincesMap)

      assetsRef.current = {
        baseImg,
        provincesImageData,
        provincesMap,
        borderCanvas,
        highlightCanvas: null,
        selectedColor: null,
      }

      initScale(baseImg.naturalWidth, baseImg.naturalHeight)
      setIsLoading(false)
    })

    return () => {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopDrag)
      canvas.removeEventListener('mouseleave', stopDrag)
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  return { selectedProvince, isLoading }
}
