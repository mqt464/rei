import { mount } from 'svelte'

import './assets/main.css'
import './components/ui/ui.css'
import '@fontsource-variable/jetbrains-mono'
import { initializeTheme } from './theme'
import { initializePreferences } from './preferences'

import App from './App.svelte'
import Sidebar from './Sidebar.svelte'
import ContextMenu from './ContextMenu.svelte'
import FindInPage from './FindInPage.svelte'
import SplitView from './SplitView.svelte'
import SplitDivider from './SplitDivider.svelte'

if (location.hash === '#context-menu') document.documentElement.dataset.surface = 'context-menu'
if (location.hash === '#find') document.documentElement.dataset.surface = 'find'
if (location.hash.startsWith('#split')) document.documentElement.dataset.surface = 'split'

void Promise.all([initializeTheme(), initializePreferences()]).then(() => {
  mount(
    location.hash === '#split-divider'
      ? SplitDivider
      : location.hash === '#split'
        ? SplitView
        : location.hash === '#find'
          ? FindInPage
          : location.hash === '#context-menu'
            ? ContextMenu
            : location.hash === '#tabs'
              ? Sidebar
              : App,
    {
      target: document.getElementById('app')!
    }
  )
})
