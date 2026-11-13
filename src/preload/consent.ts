import ConsentEngine from '../../resources/consent-o-matic/ConsentEngine.js'
import Action from '../../resources/consent-o-matic/Action.js'
import Tools from '../../resources/consent-o-matic/Tools.js'
import rules from '../../resources/consent-o-matic/rules.json'

let enabled = false
let generation = 0
let engine: ConsentEngine | undefined
let verifiedChoices = new WeakSet<object>()

const createAction = Action.createAction
Action.createAction = function (config, cmp) {
  const action = createAction.call(this, config, cmp)
  const execute = action.execute
  const version = generation
  action.execute = async function (...parameters) {
    if (!enabled || version !== generation) throw new Error('Consent rejection stopped.')
    const type = (config as { type?: string }).type
    if (type === 'hide') return
    if (type === 'click' && !verifiedChoices.has(cmp as object)) {
      const target = Tools.find(config).target
      if (
        target?.matches('button, a, input[type=submit], input[type=button]') &&
        !target.hasAttribute('aria-checked')
      ) {
        const label = `${target.id} ${target.textContent} ${target.getAttribute('aria-label') ?? ''}`
        if (
          /accept|allow|agree|continue|confirm|save|submit/i.test(label) &&
          !/reject|decline|deny|necessary|essential|without/i.test(label)
        )
          throw new Error('Consent choices could not be verified; leaving the banner unchanged.')
      }
    }
    const choices =
      (action as typeof action & { consents?: { isEnabled(): boolean }[] }).consents ?? []
    const matched = choices.filter((choice) => {
      try {
        return typeof choice.isEnabled() === 'boolean'
      } catch {
        return false
      }
    })
    await execute.apply(this, parameters)
    for (const choice of matched) {
      if (choice.isEnabled() !== false)
        throw new Error('Optional consent remains enabled; not submitting choices.')
      verifiedChoices.add(cmp as object)
    }
  }
  return action
}

function start(): void {
  if (
    !enabled ||
    engine ||
    !/^https?:$/.test(location.protocol) ||
    document.contentType !== 'text/html'
  )
    return
  ConsentEngine.debugValues = { skipHideMethod: true }
  ConsentEngine.generalSettings = { hideInsteadOfPIP: true }
  ConsentEngine.topFrameUrl = location.hostname
  const consentRules = Object.fromEntries(
    Object.entries(rules).filter(([, rule]) => {
      const methods = rule.methods.filter((method) => 'action' in method && method.action)
      return !(methods.length === 1 && methods[0].name === 'UTILITY')
    })
  )
  engine = new ConsentEngine(
    consentRules,
    { A: false, B: false, D: false, E: false, F: false, X: false },
    () => {}
  )
  ConsentEngine.singleton = engine
}

export function applyConsentRejection(value: boolean): void {
  if (value === enabled) return
  enabled = value
  generation++
  verifiedChoices = new WeakSet()
  if (!enabled && engine) {
    engine.stopObserver()
    clearTimeout(engine.queueId)
    clearTimeout(engine.stopEngineId)
    clearInterval(engine.domScannerIntervalID)
    engine = undefined
    ConsentEngine.singleton = undefined
  }
  if (document.readyState !== 'loading') start()
}

document.addEventListener('DOMContentLoaded', start, { once: true })
window.addEventListener('pagehide', () => applyConsentRejection(false), { once: true })
