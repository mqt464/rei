export const websitePermissionLabels = {
  camera: 'Camera',
  microphone: 'Microphone',
  location: 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Read clipboard',
  'clipboard-write': 'Write clipboard'
} as const

export type WebsitePermission = keyof typeof websitePermissionLabels

export interface WebsitePermissionScope {
  contentsId: number
}

export interface WebsitePermissionDecision {
  origin: string
  topOrigin: string
  permission: WebsitePermission
  allowed: boolean
}
