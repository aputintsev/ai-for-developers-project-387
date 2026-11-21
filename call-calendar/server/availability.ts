import type { Slot } from '../src/api/generated/models/slot.ts'
import { bookingWindow, calendarTimeZone } from '../src/lib/calendar-time.ts'

const minuteMs = 60_000
const workdayMinutes = 8 * 60
const startStepMinutes = 15

const moscowOffsetFormatter = new Intl.DateTimeFormat('en', {
  timeZone: calendarTimeZone,
  timeZoneName: 'longOffset',
})

export function isBookableDate(date: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const { first, last } = bookingWindow(now)
  const calendarDay = new Date(`${date}T00:00:00Z`)
  return date >= first && date <= last
    && !Number.isNaN(calendarDay.getTime()) && calendarDay.toISOString().startsWith(date)
}

export function workingSlots(date: string, durationMinutes: number): Slot[] {
  const day = new Date(`${date}T10:00:00Z`)
  const weekday = day.getUTCDay()
  if (weekday === 0 || weekday === 6) return []

  const offset = moscowOffsetFormatter.formatToParts(day)
    .find(({ type }) => type === 'timeZoneName')?.value.slice(3)
  const opening = Date.parse(`${date}T10:00:00${offset || 'Z'}`)
  const slots: Slot[] = []
  for (let minutes = 0; minutes + durationMinutes <= workdayMinutes; minutes += startStepMinutes) {
    const start = opening + minutes * minuteMs
    slots.push({
      start: new Date(start).toISOString(),
      end: new Date(start + durationMinutes * minuteMs).toISOString(),
    })
  }
  return slots
}
