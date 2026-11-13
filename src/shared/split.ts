export const splitDividerWidth = 2
export const splitDividerHitWidth = 12

export function splitGeometry(
  width: number,
  preferred = 0.5
): {
  leftWidth: number
  rightWidth: number
  ratio: number
  minimum: number
  maximum: number
} {
  const available = Math.max(0, Math.floor(width) - splitDividerWidth)
  const minimumWidth = Math.min(160, Math.floor(available / 2))
  const minimum = available ? Math.max(0.15, minimumWidth / available) : 0.5
  const maximum = 1 - minimum
  const ratio = Math.max(minimum, Math.min(maximum, Number.isFinite(preferred) ? preferred : 0.5))
  const leftWidth = Math.round(available * ratio)
  return {
    leftWidth,
    rightWidth: available - leftWidth,
    ratio: available ? leftWidth / available : 0.5,
    minimum,
    maximum
  }
}
