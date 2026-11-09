export function actionError(failure: unknown, fallback: string): string {
  return failure instanceof Error
    ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : fallback
}
