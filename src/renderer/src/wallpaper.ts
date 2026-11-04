import type { Theme } from '../../shared/theme'

export async function renderWallpaper(source: string, dither: boolean): Promise<string> {
  if (!dither) return source
  const image = new Image()
  image.src = source
  await image.decode()
  if (image.naturalWidth * image.naturalHeight > 40000000)
    throw new Error('Wallpaper exceeds 40 megapixels.')
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const matrix = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  for (let row = 0; row < canvas.height; row++) {
    for (let column = 0; column < canvas.width; column++) {
      const offset = (row * canvas.width + column) * 4
      const threshold = (matrix[(row % 4) * 4 + (column % 4)] / 16 - 0.5) * 85
      for (let channel = 0; channel < 3; channel++)
        pixels.data[offset + channel] =
          Math.round((pixels.data[offset + channel] + threshold) / 85) * 85
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}

export function wallpaperKey(value: Theme): string {
  return JSON.stringify([
    value.wallpaper,
    value.wallpaperFolder,
    value.wallpaperDither,
    value.wallpaperInterval
  ])
}
