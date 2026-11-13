export default class ConsentEngine {
  static debugValues: Record<string, boolean>
  static generalSettings: Record<string, boolean>
  static topFrameUrl: string
  static singleton: ConsentEngine | undefined
  constructor(
    rules: object,
    choices: Record<string, boolean>,
    handled: (event: { handled: boolean }) => void
  )
  stopObserver(): void
  queueId?: ReturnType<typeof setTimeout>
  stopEngineId?: ReturnType<typeof setTimeout>
  domScannerIntervalID?: ReturnType<typeof setInterval>
}
