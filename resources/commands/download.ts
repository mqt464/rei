import { defineCommand } from 'rei/commands'

export default defineCommand({
  name: 'Download',
  command: 'download',
  description: 'Download media playing in the active tab.',
  version: '1.0.0',
  intent: {
    'activeTab.media': 'Identify the video or audio you are playing.',
    'downloads.enqueue': 'Save that media to your download folder.'
  },
  async run(context) {
    const media = await context.activeTab.media.current()
    await context.downloads.enqueue(media)
  }
})
