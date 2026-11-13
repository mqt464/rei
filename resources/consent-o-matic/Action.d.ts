export default class Action {
  static createAction(
    config: unknown,
    cmp: unknown
  ): { execute(...parameters: unknown[]): Promise<void> }
}
