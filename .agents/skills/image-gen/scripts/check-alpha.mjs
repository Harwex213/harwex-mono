// Проверка reference-кадра с прозрачным фоном: RGBA, реально пустые углы,
// субъект не упирается в края. Запускается сразу после генерации.
//
//   node check-alpha.mjs <file.png> [...]
//
// Без внешних зависимостей: PNG распаковывается через zlib + ручной un-filter.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG')
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  const depth = buf[24]
  const colorType = buf[25]
  if (depth !== 8) throw new Error(`ожидалось 8 бит на канал, получено ${depth}`)
  if (colorType !== 6) return { w, h, colorType, pixels: null }

  const chunks = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    if (type === 'IDAT') chunks.push(buf.subarray(off + 8, off + 8 + len))
    off += len + 12
    if (type === 'IEND') break
  }

  const raw = inflateSync(Buffer.concat(chunks))
  const bpp = 4
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + x] = v & 0xff
    }
  }
  return { w, h, colorType, pixels: out }
}

/** Доля непрозрачных пикселей в рамке шириной frame по краю кадра. */
function edgeCoverage(px, w, h, frame) {
  let hit = 0
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x < frame || y < frame || x >= w - frame || y >= h - frame
      if (!edge) continue
      total++
      if (px[(y * w + x) * 4 + 3] > 16) hit++
    }
  }
  return hit / total
}

let failed = 0
for (const file of process.argv.slice(2)) {
  const { w, h, colorType, pixels } = decode(readFileSync(file))
  const problems = []

  if (colorType !== 6) {
    problems.push(`colorType ${colorType} — нет альфа-канала`)
  } else {
    // Фон с виньеткой/глоу проваливает именно эту проверку: альфа непустая по краям.
    const cov = edgeCoverage(pixels, w, h, Math.max(4, Math.round(Math.min(w, h) * 0.02)))
    if (cov > 0.02) problems.push(`фон непустой: ${(cov * 100).toFixed(1)}% края непрозрачно`)

    let minX = w, minY = h, maxX = -1, maxY = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[(y * w + x) * 4 + 3] <= 16) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) problems.push('кадр пустой')
    else {
      const pad = Math.min(minX, minY, w - 1 - maxX, h - 1 - maxY)
      if (pad < 2) problems.push('субъект обрезан краем кадра')
      const fill = ((maxY - minY) / h) * 100
      if (fill < 45) problems.push(`субъект мелкий: ${fill.toFixed(0)}% высоты кадра`)
    }
  }

  const tag = problems.length ? 'ПРОБЛЕМА' : 'ок'
  console.log(`${tag}  ${file}  ${w}x${h}${problems.length ? '  — ' + problems.join('; ') : ''}`)
  if (problems.length) failed++
}

process.exit(failed ? 1 : 0)
