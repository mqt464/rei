function installScrollbarActivity(): void {
  if (!/^https?:$/.test(location.protocol)) return
  const timers = new Map<Element, ReturnType<typeof setTimeout>>()
  const colored = new Set<HTMLElement>()
  const ownStyles = new WeakMap<HTMLElement, string | null>()
  const forcedColors = matchMedia('(forced-colors: active)')
  let colorTimer: ReturnType<typeof setTimeout> | undefined
  let pressed = false

  function readColors(element: HTMLElement): [string, string] | undefined {
    const style = getComputedStyle(element)
    if (forcedColors.matches || style.scrollbarWidth !== 'auto' || style.scrollbarColor === 'auto')
      return
    const colors = style.scrollbarColor
    let depth = 0
    for (let index = 0; index < colors.length; index++) {
      if (colors[index] === '(') depth++
      else if (colors[index] === ')') depth--
      else if (colors[index] === ' ' && depth === 0)
        return [colors.slice(0, index), colors.slice(index + 1)]
    }
    return
  }

  function applyColors(element: HTMLElement, colors: [string, string] | undefined): void {
    if (colors) {
      element.style.setProperty('--rei-website-scrollbar-thumb', colors[0])
      element.style.setProperty('--rei-website-scrollbar-track', colors[1])
      element.setAttribute('data-rei-scrollbar-colors', '')
      colored.add(element)
    } else {
      element.style.removeProperty('--rei-website-scrollbar-thumb')
      element.style.removeProperty('--rei-website-scrollbar-track')
      colored.delete(element)
    }
    ownStyles.set(element, element.getAttribute('style'))
  }

  function syncColors(): void {
    colorTimer = undefined
    const elements = new Set(colored)
    if (document.documentElement) elements.add(document.documentElement)
    for (const element of elements) element.removeAttribute('data-rei-scrollbar-colors')
    const readings = [...elements].map((element) => ({ element, colors: readColors(element) }))
    for (const { element, colors } of readings) {
      if (element.isConnected) applyColors(element, colors)
      else colored.delete(element)
    }
  }

  function scheduleColors(): void {
    if (colorTimer === undefined) colorTimer = setTimeout(syncColors, 0)
  }

  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        if (record.attributeName?.startsWith('data-rei-scrollbar-')) return false
        return (
          record.attributeName !== 'style' ||
          !(record.target instanceof HTMLElement) ||
          record.target.getAttribute('style') !== ownStyles.get(record.target)
        )
      })
    )
      scheduleColors()
  })

  function watchColors(): void {
    observer.observe(document.documentElement, { attributes: true })
    if (document.body) observer.observe(document.body, { attributes: true })
    if (document.head)
      observer.observe(document.head, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      })
    syncColors()
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', watchColors, { once: true })
  else watchColors()
  document.addEventListener(
    'load',
    (event) => {
      if (event.target instanceof HTMLLinkElement && event.target.relList.contains('stylesheet'))
        scheduleColors()
    },
    true
  )
  forcedColors.addEventListener('change', scheduleColors)

  function reveal(element: Element): void {
    if (element instanceof HTMLElement && !colored.has(element)) {
      const colors = readColors(element)
      if (colors) {
        applyColors(element, colors)
        observer.observe(element, { attributes: true })
      }
    }
    clearTimeout(timers.get(element))
    element.setAttribute('data-rei-scrollbar-active', '')
    timers.set(
      element,
      setTimeout(() => {
        if (pressed) {
          reveal(element)
          return
        }
        element.removeAttribute('data-rei-scrollbar-active')
        timers.delete(element)
      }, 2000)
    )
  }

  function nearScrollbar(event: PointerEvent): void {
    for (const element of event.composedPath()) {
      if (!(element instanceof Element)) continue
      const vertical = element.scrollHeight > element.clientHeight
      const horizontal = element.scrollWidth > element.clientWidth
      if (!vertical && !horizontal) continue
      const root = element === document.scrollingElement
      const bounds = root
        ? { left: 0, right: innerWidth, bottom: innerHeight }
        : element.getBoundingClientRect()
      if (
        (vertical &&
          (Math.abs(event.clientX - bounds.right) <= 20 ||
            Math.abs(event.clientX - bounds.left) <= 20)) ||
        (horizontal && Math.abs(event.clientY - bounds.bottom) <= 20)
      )
        reveal(element)
    }
  }

  document.addEventListener(
    'scroll',
    (event) => {
      const element = event.target === document ? document.scrollingElement : event.target
      if (element instanceof Element) reveal(element)
    },
    { capture: true, passive: true }
  )
  document.addEventListener('pointermove', nearScrollbar, { passive: true })
  document.addEventListener(
    'pointerdown',
    (event) => {
      pressed = true
      nearScrollbar(event)
    },
    { passive: true }
  )
  document.addEventListener(
    'pointerup',
    () => {
      pressed = false
    },
    { passive: true }
  )
  document.addEventListener(
    'pointercancel',
    () => {
      pressed = false
    },
    { passive: true }
  )
  window.addEventListener('blur', () => {
    pressed = false
  })
  window.addEventListener('pagehide', () => {
    pressed = false
    for (const [element, timer] of timers) {
      clearTimeout(timer)
      element.removeAttribute('data-rei-scrollbar-active')
    }
    timers.clear()
  })
}

installScrollbarActivity()
