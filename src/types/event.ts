import { Dayjs } from "dayjs"

export interface EventItem {
    id: string
    title: string
    date: string // YYYY-MM-DD
    startTime?: string // HH:mm
    endTime?: string // HH:mm
    type?: 'meeting' | 'deadline' | 'event' | 'workshop' | string
    format?: 'virtual' | 'in-person' | string
    location?: string
    link?: string
    description?: string
    createdBy?: string
    participants?: Array<{
      id?: string
      email?: string
      type?: string
      confirmationStatus?: string
    }>
    time?: Dayjs
  }
