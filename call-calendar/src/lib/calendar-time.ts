export const calendarTimeZone = 'Europe/Moscow'

const moscowDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: calendarTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const moscowTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: calendarTimeZone,
  hour: '2-digit',
  minute: '2-digit',
})

export function moscowDate(instant: Date) {
  return moscowDateFormatter.format(instant)
}

export function bookingWindow(now: Date) {
  const firstDay = new Date(`${moscowDate(now)}T00:00:00Z`)
  firstDay.setUTCDate(firstDay.getUTCDate() + 1)
  const lastDay = new Date(firstDay)
  lastDay.setUTCDate(lastDay.getUTCDate() + 13)

  return {
    first: firstDay.toISOString().slice(0, 10),
    last: lastDay.toISOString().slice(0, 10),
  }
}

function moscowTime(instant: string) {
  return moscowTimeFormatter.format(new Date(instant))
}

export function moscowDateDetails(instant: string) {
  const date = moscowDate(new Date(instant))
  return { date, dateLabel: date.split('-').reverse().join('.') }
}

export function moscowTimeRange({ start, end }: { start: string; end: string }) {
  return `${moscowTime(start)}–${moscowTime(end)}`
}
