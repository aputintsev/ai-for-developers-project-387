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
const followUp = { ...intro, id: 'follow-up', name: 'Обсуждение', durationMinutes: 15 }
const guest = { guestName: 'Анна', guestEmail: 'anna@example.com' }
const otherGuest = { guestName: 'Иван', guestEmail: 'ivan@example.com' }

let server
let now

async function startCalendar() {
  now = new Date('2026-11-18T21:30:00Z')
  server = await createServer({
    ...createCalendarConfig([intro, followUp], () => now),
    configFile: false,
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  await server.listen()
  return `http://127.0.0.1:${server.httpServer.address().port}`
}

async function book(baseUrl, meetingType, start, contact) {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingTypeId: meetingType.id, start, ...contact }),
  })
  expect(response.status).toBe(201)
}

afterEach(async () => {
  await server?.close()
})

test('the public Owner API lists future bookings across profiles and types in chronological order', async () => {
  const baseUrl = await startCalendar()
  const url = `${baseUrl}/api/owner/bookings`
  const empty = await fetch(url)
  expect(empty.status).toBe(200)
  expect(await empty.json()).toEqual([])

  await book(baseUrl, followUp, '2026-11-20T09:00:00.000Z', otherGuest)
  await book(baseUrl, intro, '2026-11-20T08:00:00.000Z', guest)
  await book(baseUrl, intro, '2026-11-20T07:30:00.000Z', guest)
  await book(baseUrl, followUp, '2026-11-20T07:00:00.000Z', otherGuest)
  now = new Date('2026-11-20T07:30:00.000Z')

  const response = await fetch(url)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([
    {
      id: expect.any(String),
      meetingType: intro,
      start: '2026-11-20T08:00:00.000Z',
      end: '2026-11-20T08:30:00.000Z',
      ...guest,
    },
    {
      id: expect.any(String),
      meetingType: followUp,
      start: '2026-11-20T09:00:00.000Z',
      end: '2026-11-20T09:15:00.000Z',
      ...otherGuest,
    },
  ])
})

test('the Owner sees an empty state and then the details of upcoming bookings in Moscow time', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' })
    await page.goto(baseUrl)
    await page.getByRole('link', { name: 'Раздел Владельца' }).click()

    const upcoming = page.getByRole('region', { name: 'Предстоящие записи' })
    await upcoming.getByText('Нет предстоящих записей', { exact: true }).waitFor({ timeout: 3_000 })
    await book(baseUrl, followUp, '2026-11-20T09:00:00.000Z', otherGuest)
    await book(baseUrl, intro, '2026-11-20T08:00:00.000Z', guest)
    await page.reload()

    await upcoming.getByText('Время по Москве (Europe/Moscow)', { exact: true }).waitFor({ timeout: 3_000 })
    const items = upcoming.getByRole('listitem')
    const first = items.nth(0)
    await first.getByText(intro.name, { exact: true }).waitFor()
    await first.getByText('20.11.2026', { exact: true }).waitFor()
    await first.getByText('11:00–11:30', { exact: true }).waitFor()
    await first.getByText('30 мин', { exact: true }).waitFor()
    await first.getByText(guest.guestName, { exact: true }).waitFor()
    await first.getByText(guest.guestEmail, { exact: true }).waitFor()
    const second = items.nth(1)
    await second.getByText(followUp.name, { exact: true }).waitFor()
    await second.getByText('12:00–12:15', { exact: true }).waitFor()
    await second.getByText('15 мин', { exact: true }).waitFor()
    await second.getByText(otherGuest.guestName, { exact: true }).waitFor()
    await second.getByText(otherGuest.guestEmail, { exact: true }).waitFor()
    expect(await items.count()).toBe(2)
  } finally {
    await browser.close()
  }
}, 15_000)
