export interface HistoryVisit {
  id: number
  url: string
  title: string
  favicon: string | null
  visitedAt: number
}

export interface HistoryQuery {
  query: string
  start: number
  end: number
  offset: number
  host: string
}

export interface HistoryPage {
  visits: HistoryVisit[]
  total: number
}

export interface HistoryRemoval {
  ids?: number[]
  start?: number
  end?: number
}

export const historyPageSize = 50

export function parseHistoryQuery(value: unknown): HistoryQuery {
  if (!value || typeof value !== 'object') throw new Error('Invalid history filter.')
  const query = value as HistoryQuery
  if (
    typeof query.query !== 'string' ||
    query.query.length > 512 ||
    typeof query.host !== 'string' ||
    query.host.length > 259 ||
    !Number.isSafeInteger(query.start) ||
    query.start < 0 ||
    !Number.isSafeInteger(query.end) ||
    query.end <= query.start ||
    !Number.isSafeInteger(query.offset) ||
    query.offset < 0
  )
    throw new Error('Invalid history filter.')
  return query
}

export function parseHistoryRemoval(value: unknown): HistoryRemoval {
  if (!value || typeof value !== 'object') throw new Error('Invalid history selection.')
  const removal = value as HistoryRemoval
  if (removal.ids !== undefined) {
    if (
      !Array.isArray(removal.ids) ||
      !removal.ids.length ||
      removal.ids.length > historyPageSize ||
      removal.ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      removal.start !== undefined ||
      removal.end !== undefined
    )
      throw new Error('Invalid history selection.')
  } else if (
    !Number.isSafeInteger(removal.start) ||
    removal.start! < 0 ||
    !Number.isSafeInteger(removal.end) ||
    removal.end! <= removal.start!
  ) {
    throw new Error('Choose a valid time range.')
  }
  return removal
}
