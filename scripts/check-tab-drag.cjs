const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const browser = fs.readFileSync(path.join(root, 'src/main/browser.ts'), 'utf8')
const sidebar = fs.readFileSync(path.join(root, 'src/renderer/src/Sidebar.svelte'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src/renderer/src/assets/main.css'), 'utf8')
const hover = fs.readFileSync(
  path.join(root, 'src/renderer/src/components/FluidHover.svelte'),
  'utf8'
)
const reorderSource = browser.slice(
  browser.indexOf('  function reorderTab('),
  browser.indexOf('  function isTrusted(')
)
const tabs = new Map()
let publishes = 0
const reorderTab = new Function(
  'tabs',
  'publish',
  ts.transpile(reorderSource, { target: ts.ScriptTarget.ES2022 }) + '; return reorderTab'
)(tabs, () => publishes++)

function checkOrder(source, target, expected) {
  tabs.clear()
  for (const id of ['first', 'middle', 'last']) tabs.set(id, { id })
  reorderTab(source, target)
  assert.deepEqual([...tabs.keys()], expected)
}

checkOrder('first', '', ['middle', 'last', 'first'])
checkOrder('middle', '', ['first', 'last', 'middle'])
checkOrder('last', '', ['first', 'middle', 'last'])
checkOrder('last', 'first', ['last', 'first', 'middle'])
checkOrder('first', 'last', ['middle', 'first', 'last'])
const beforeInvalid = publishes
checkOrder('missing', '', ['first', 'middle', 'last'])
checkOrder('first', 'missing', ['first', 'middle', 'last'])
assert.equal(publishes, beforeInvalid)

const targetingSource = sidebar.slice(
  sidebar.indexOf('  function updateDropTarget('),
  sidebar.indexOf('  function resetDrag(')
)
assert.ok(targetingSource.includes('function updateDropTarget('))
const rows = ['first', 'middle', 'last'].map((id, index) => ({
  dataset: { tabId: id },
  getBoundingClientRect: () => ({ top: 100 + index * 31, bottom: 130 + index * 31 })
}))
const tabList = {
  querySelectorAll: () => rows,
  getBoundingClientRect: () => ({ top: 100 }),
  scrollHeight: 93
}
const targetAt = new Function(
  'tabList',
  ts.transpile(
    'let dropTargetTabId = null; let dropIndicatorY = 0;' +
      targetingSource +
      '; return (clientY, types = ["application/x-rei-tab"]) => { dropTargetTabId = null; updateDropTarget({ clientY, dataTransfer: { types }, preventDefault() {} }); return { target: dropTargetTabId, y: dropIndicatorY }; }',
    { target: ts.ScriptTarget.ES2022 }
  )
)(tabList)
assert.deepEqual(targetAt(110), { target: 'first', y: 0 })
assert.deepEqual(targetAt(145), { target: 'middle', y: 31 })
assert.deepEqual(targetAt(145, ['text/plain']), { target: null, y: 31 })
assert.deepEqual(targetAt(175), { target: 'last', y: 62 })
assert.deepEqual(targetAt(300), { target: '', y: 92 })
assert.deepEqual(targetAt(1000), { target: '', y: 92 })
assert.deepEqual(targetAt(145), { target: 'middle', y: 31 })
const transition =
  'transform var(--rei-hover-duration, var(--rei-duration-slow)) cubic-bezier(0.2, 0.8, 0.2, 1)'
assert.ok(styles.includes(transition))
assert.ok(hover.includes(transition))
assert.match(styles, /height: 1px;\s*background: var\(--rei-accent\)/)
assert.match(sidebar, /on:dragover=\{updateDropTarget\}/)
const dragImageSource = sidebar.slice(
  sidebar.indexOf('  function setTabDragImage('),
  sidebar.indexOf('  function updateDropTarget(')
)
let cleanup
let dragImage
let appended
const previewClasses = new Set(['dragging'])
const previewAttributes = new Map()
const preview = {
  classList: {
    remove: (name) => previewClasses.delete(name),
    add: (name) => previewClasses.add(name)
  },
  style: {},
  setAttribute: (name, value) => previewAttributes.set(name, value),
  remove() {
    appended = null
  }
}
const row = {
  getBoundingClientRect: () => ({ left: 10, top: 100, width: 200 }),
  cloneNode: (deep) => {
    assert.equal(deep, true)
    return preview
  },
  parentElement: {
    appendChild: (element) => {
      appended = element
    }
  }
}
const setTabDragImage = new Function(
  'requestAnimationFrame',
  ts.transpile(dragImageSource, { target: ts.ScriptTarget.ES2022 }) + '; return setTabDragImage'
)((callback) => {
  cleanup = callback
})
setTabDragImage(
  {
    clientX: 45,
    clientY: 112,
    dataTransfer: {
      setDragImage: (...args) => {
        dragImage = args
      }
    }
  },
  row
)
assert.deepEqual(dragImage, [preview, 35, 12])
assert.equal(preview.style.width, '200px')
assert.equal(preview.style.left, '10px')
assert.equal(preview.style.top, '100px')
assert.equal(previewClasses.has('dragging'), false)
assert.equal(previewClasses.has('tab-drag-preview'), true)
assert.equal(previewAttributes.get('aria-hidden'), 'true')
assert.equal(appended, preview)
cleanup()
assert.equal(appended, null)
assert.match(sidebar, /setTabDragImage\(event, event.currentTarget\)/)
assert.doesNotMatch(styles, /top: -10000px/)
assert.match(styles, /user-select: none/)
assert.match(sidebar, /setData\('application\/x-rei-tab', token\)/)
assert.match(sidebar, /window.api.dropTab\(token, dropTargetTabId\)/)
const finishSource = sidebar.slice(
  sidebar.indexOf('  function finishDrag('),
  sidebar.indexOf('  onMount(')
)
const detached = []
const finishDrag = new Function(
  'window',
  ts.transpile(
    'let draggedTabId = ""; let dropTargetTabId = null;' +
      sidebar.slice(
        sidebar.indexOf('  function resetDrag('),
        sidebar.indexOf('  function finishDrag(')
      ) +
      finishSource +
      '; return (id, dropEffect, screenX = 900, screenY = 300) => { draggedTabId = id; finishDrag({ dataTransfer: { dropEffect }, screenX, screenY }); return draggedTabId; }',
    { target: ts.ScriptTarget.ES2022 }
  )
)({ api: { detachTab: (id) => detached.push(id) } })
assert.equal(finishDrag('first', 'none'), '')
assert.deepEqual(detached, ['first'])
finishDrag('middle', 'move')
finishDrag('middle', 'copy')
finishDrag('middle', 'none', 0, 0)
finishDrag('', 'none')
assert.deepEqual(detached, ['first'])
console.log(
  'Tab drag checks passed: reorder targets, full-row preview, tear-off requests, accepted drops, and cancelled drags.'
)
