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

if (location.hash === '#context-menu') document.documentElement.dataset.surface = 'context-menu'
if (location.hash === '#find') document.documentElement.dataset.surface = 'find'

void Promise.all([initializeTheme(), initializePreferences()]).then(() => {
  mount(
    location.hash === '#find'
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
