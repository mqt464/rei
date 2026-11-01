import { mount } from 'svelte'

import './assets/main.css'

import App from './App.svelte'
import Sidebar from './Sidebar.svelte'

const app = mount(location.hash === '#tabs' ? Sidebar : App, {
  target: document.getElementById('app')!
})

export default app
