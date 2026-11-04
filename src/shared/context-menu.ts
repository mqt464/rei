export interface ContextMenuEntry {
  id: number
  label: string
  separator: boolean
  enabled: boolean
}

export interface ContextMenuState {
  id: number
  x: number
  y: number
  items: ContextMenuEntry[]
}
