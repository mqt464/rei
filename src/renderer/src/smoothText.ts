import { get } from 'svelte/store'
import { theme } from './theme'

export function smoothText(input: HTMLInputElement): { destroy(): void } {
  const overlay = document.createElement('div')
  overlay.className = 'text-overlay'
  overlay.setAttribute('aria-hidden', 'true')
  const mirror = document.createElement('span')
  mirror.className = 'text-mirror'
  const text = document.createTextNode('')
  mirror.append(text)
  const caret = document.createElement('span')
  caret.className = 'custom-caret'
  overlay.append(mirror, caret)
  input.after(overlay)
  input.classList.add('smooth-input')
  const range = document.createRange()
  let highlights: HTMLSpanElement[] = []
  let frame = 0
  let blinkTimer: ReturnType<typeof setTimeout> | undefined
  let previous = ''
  let focused = false
  let composing = false
  let snap = true
  let editing = false

  function render(): void {
    frame = 0
    const settings = get(theme)
    const active = document.activeElement === input && document.hasFocus() && !composing
    const style = getComputedStyle(input)
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? start
    const signature = JSON.stringify([
      input.value,
      start,
      end,
      input.selectionDirection,
      settings.caretBlinkInterval,
      settings.caretBlink
    ])
    const changed = signature !== previous || active !== focused
    overlay.style.left = `${input.offsetLeft + input.clientLeft}px`
    overlay.style.top = `${input.offsetTop + input.clientTop}px`
    overlay.style.width = `${input.clientWidth}px`
    overlay.style.height = `${input.clientHeight}px`
    mirror.style.font = style.font
    mirror.style.letterSpacing = style.letterSpacing
    mirror.style.direction = style.direction
    mirror.style.fontKerning = style.fontKerning
    text.data = input.value
    const origin = mirror.getBoundingClientRect().left
    const offset = (parseFloat(style.paddingLeft) || 0) - input.scrollLeft
    range.setStart(text, input.selectionDirection === 'backward' ? start : end)
    range.collapse(true)
    const bounds = range.getBoundingClientRect()
    const position = input.value ? bounds.left - origin + offset : offset
    overlay.classList.toggle('snap', snap || !focused || (editing && !settings.caretSmoothTyping))
    caret.style.setProperty(
      '--caret-x',
      `${Math.round(position * devicePixelRatio) / devicePixelRatio}px`
    )
    caret.classList.toggle('focused', active && start === end)
    if (changed) {
      caret.classList.remove('blinking')
      clearTimeout(blinkTimer)
      if (active && start === end) {
        blinkTimer = setTimeout(
          () => caret.classList.add('blinking'),
          settings.caretBlinkInterval / 2
        )
      }
    }
    range.setStart(text, start)
    range.setEnd(text, end)
    const rectangles = active && start !== end ? Array.from(range.getClientRects()) : []
    if (rectangles.length && !highlights.length) {
      const anchor =
        input.selectionDirection === 'backward'
          ? rectangles[rectangles.length - 1].right - origin + offset
          : rectangles[0].left - origin + offset
      const highlight = document.createElement('span')
      highlight.className = 'custom-highlight'
      highlight.style.transform = `translate(${anchor}px, -50%)`
      highlight.style.width = '0px'
      overlay.prepend(highlight)
      highlights.push(highlight)
      highlight.getBoundingClientRect()
    }
    rectangles.forEach((rectangle, index) => {
      let highlight = highlights[index]
      if (!highlight) {
        highlight = document.createElement('span')
        highlight.className = 'custom-highlight'
        overlay.prepend(highlight)
        highlights.push(highlight)
      }
      highlight.style.transform = `translate(${rectangle.left - origin + offset}px, -50%)`
      highlight.style.width = `${rectangle.width}px`
      highlight.style.height = `${rectangle.height}px`
    })
    for (const highlight of highlights.slice(rectangles.length)) highlight.remove()
    highlights = highlights.slice(0, rectangles.length)
    previous = signature
    focused = active
    snap = false
    editing = false
  }

  function schedule(event?: Event): void {
    if (event?.type === 'input') editing = true
    if (event?.type === 'scroll' || event?.type === 'resize') snap = true
    if (!frame) frame = requestAnimationFrame(render)
  }
  function composition(event: Event): void {
    composing = event.type === 'compositionstart'
    input.classList.toggle('native-editing', composing)
    snap = true
    schedule()
  }
  const events = [
    'input',
    'select',
    'selectionchange',
    'keyup',
    'click',
    'focus',
    'blur',
    'scroll',
    'rei:sync-caret'
  ]
  for (const event of events) input.addEventListener(event, schedule)
  input.addEventListener('compositionstart', composition)
  input.addEventListener('compositionend', composition)
  window.addEventListener('resize', schedule)
  window.addEventListener('focus', schedule)
  window.addEventListener('blur', schedule)
  document.fonts.addEventListener('loadingdone', schedule)
  const observer = new ResizeObserver(() => {
    snap = true
    schedule()
  })
  observer.observe(input)
  const unsubscribe = theme.subscribe(() => {
    snap = true
    schedule()
  })

  return {
    destroy() {
      cancelAnimationFrame(frame)
      clearTimeout(blinkTimer)
      observer.disconnect()
      unsubscribe()
      for (const event of events) input.removeEventListener(event, schedule)
      input.removeEventListener('compositionstart', composition)
      input.removeEventListener('compositionend', composition)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', schedule)
      window.removeEventListener('blur', schedule)
      document.fonts.removeEventListener('loadingdone', schedule)
      input.classList.remove('smooth-input', 'native-editing')
      overlay.remove()
    }
  }
}
