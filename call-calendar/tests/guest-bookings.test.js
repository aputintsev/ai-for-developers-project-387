import { afterEach, expect, test } from 'vitest'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { createCalendarConfig } from '../vite.config'

const intro = {
  id: 'intro',
  name: 'Знакомство',
  description: 'Обсудим ваши цели',
  durationMinutes: 30,
}
const guest = { guestName: 'Анна', guestEmail: 'anna@example.com' }
const initialNow = '2026-11-18T21:30:00Z'
let now
let server

async function startCalendar() {
  now = new Date(initialNow)
  server = await createServer({
    ...createCalendarConfig([intro], () => now),
    configFile: false,
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  await server.listen()
  return `http://127.0.0.1:${server.httpServer.address().port}`
}

async function book(baseUrl, start, cookie) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...guest, meetingTypeId: intro.id, start }),
  })
  expect(response.status).toBe(201)
  return { booking: await response.json(), cookie: response.headers.get('Set-Cookie')?.split(';')[0] }
}

async function guestBookings(baseUrl, cookie) {
  const response = await fetch(`${baseUrl}/api/guest/bookings`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
  expect(response.status).toBe(200)
  return response.json()
}

afterEach(async () => {
  await server?.close()
})

test('lists only strictly future bookings in the current Guest profile, ordered by start', async () => {
  const baseUrl = await startCalendar()
  const { booking: later, cookie } = await book(baseUrl, '2026-11-20T09:00:00.000Z')
  expect(cookie).toMatch(/^calendarGuest=[0-9a-f]{64}$/)
  const { booking: earlier } = await book(baseUrl, '2026-11-20T08:00:00.000Z', cookie)
  await book(baseUrl, '2026-11-20T07:00:00.000Z', cookie)
  const { booking: otherBooking, cookie: otherCookie } = await book(baseUrl, '2026-11-20T10:00:00.000Z')
  expect(otherCookie).toMatch(/^calendarGuest=[0-9a-f]{64}$/)
  expect(otherCookie).not.toBe(cookie)

  now = new Date('2026-11-20T07:00:00.000Z')
  expect(await guestBookings(baseUrl, cookie)).toEqual([
    { id: earlier.id, meetingType: intro, start: '2026-11-20T08:00:00.000Z', end: '2026-11-20T08:30:00.000Z' },
    { id: later.id, meetingType: intro, start: '2026-11-20T09:00:00.000Z', end: '2026-11-20T09:30:00.000Z' },
  ])
  expect(await guestBookings(baseUrl, otherCookie)).toEqual([
    { id: otherBooking.id, meetingType: intro, start: '2026-11-20T10:00:00.000Z', end: '2026-11-20T10:30:00.000Z' },
  ])
  expect(await guestBookings(baseUrl)).toEqual([])
})

test('a Guest sees booking details in Moscow time and can book from the empty list', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' })
    await page.goto(baseUrl)
    await page.getByRole('link', { name: 'Предстоящие записи', exact: true }).click()
    await page.getByText('У вас нет предстоящих записей', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Записаться', exact: true }).click()
    await page.getByRole('heading', { name: 'Выбор типа встречи' }).waitFor()

    const response = await page.request.post(`${baseUrl}/api/bookings`, {
      data: { ...guest, meetingTypeId: intro.id, start: '2026-11-20T07:00:00.000Z' },
    })
    expect(response.status()).toBe(201)
    await page.getByRole('link', { name: 'На главную' }).click()
    await page.getByRole('link', { name: 'Предстоящие записи', exact: true }).click()
    const booking = page.getByRole('listitem').filter({ hasText: intro.name })
    await booking.getByText(intro.name, { exact: true }).waitFor()
    await booking.getByText('20.11.2026', { exact: true }).waitFor()
    await booking.getByText('10:00–10:30', { exact: true }).waitFor()
    await booking.getByText('30 мин', { exact: true }).waitFor()
    await page.getByText('Время по Москве (Europe/Moscow)', { exact: true }).waitFor()

    await page.context().clearCookies()
    await page.reload()
    await page.getByText('У вас нет предстоящих записей', { exact: true }).waitFor()
  } finally {
    await browser.close()
  }
}, 15_000)
