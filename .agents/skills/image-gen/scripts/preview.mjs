// Композит RGBA-рефа на плотный фон — чтобы глазами увидеть ровно то, что увидит потребитель картинки (Tripo, движок).
// Без этого легко забраковать годный кадр: просмотрщики часто показывают RGB
// прозрачных пикселей (запечённое свечение), которого в альфе на самом деле нет.
//
//   node preview.mjs <file.png> [...]  → рядом кладёт <file>.preview.png на белом
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const BG = [255, 255, 255]

function decode(buf) {
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (buf[25] !== 6 || buf[24] !== 8) throw new Error('нужен 8-битный RGBA PNG')
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
  const stride = w * 4
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + x] = v & 0xff
    }
  }
  return { w, h, px: out }
}

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return (buf) => {
    let c = -1
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(CRC(body))
  return Buffer.concat([len, body, crc])
}

function encodeRGB(w, h, rgb) {
  const stride = w * 3
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const file of process.argv.slice(2)) {
  const { w, h, px } = decode(readFileSync(file))
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    const a = px[i + 3] / 255
    for (let k = 0; k < 3; k++) rgb[j + k] = Math.round(px[i + k] * a + BG[k] * (1 - a))
  }
  const dest = file.replace(/\.png$/i, '.preview.png')
  writeFileSync(dest, encodeRGB(w, h, rgb))
  console.log(dest)
}
