import { afterEach, expect, test } from 'vitest'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { createCalendarConfig } from '../vite.config'

const meetingType = {
  id: 'intro',
  name: 'Знакомство',
  description: 'Обсудим ваши цели',
  durationMinutes: 30,
}

const now = new Date('2026-11-18T21:30:00Z')
let server

async function startCalendar() {
  server = await createServer({
    ...createCalendarConfig([meetingType], () => now),
    configFile: false,
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  await server.listen()
  return `http://127.0.0.1:${server.httpServer.address().port}`
}

afterEach(async () => {
  await server?.close()
})

test('the API lists 15-minute starts for meetings that fit work hours in Moscow', async () => {
  const baseUrl = await startCalendar()
  const response = await fetch(`${baseUrl}/api/meeting-types/intro/slots?date=2026-11-20`)
  expect(response.status).toBe(200)
  const { timeZone, slots } = await response.json()
  expect(timeZone).toBe('Europe/Moscow')
  expect(slots).toHaveLength(31)
  expect(slots[0]).toEqual({ start: '2026-11-20T07:00:00.000Z', end: '2026-11-20T07:30:00.000Z' })
  expect(slots.at(-1)).toEqual({ start: '2026-11-20T14:30:00.000Z', end: '2026-11-20T15:00:00.000Z' })
  expect(slots.slice(1).map(({ start }, i) => Date.parse(start) - Date.parse(slots[i].start)))
    .toEqual(Array(30).fill(15 * 60_000))
  expect(slots.map(({ start, end }) => Date.parse(end) - Date.parse(start)))
    .toEqual(Array(31).fill(30 * 60_000))
})

test('the API applies both booking-window boundaries by the Moscow calendar', async () => {
  const baseUrl = await startCalendar()
  const getSlots = (date) => fetch(`${baseUrl}/api/meeting-types/intro/slots?date=${date}`)

  const lastDay = await getSlots('2026-12-03')
  expect(lastDay.status).toBe(200)
  expect((await lastDay.json()).slots[0]).toEqual({
    start: '2026-12-03T07:00:00.000Z',
    end: '2026-12-03T07:30:00.000Z',
  })

  for (const date of ['2026-11-19', '2026-12-04', '2026-11-31', '']) {
    const response = await getSlots(date)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: 'Выберите дату в пределах 14 дней с завтрашнего дня по Москве.',
    })
  }
})

test('the API returns 404 and an error body for an unknown meeting type', async () => {
  const baseUrl = await startCalendar()
  const response = await fetch(`${baseUrl}/api/meeting-types/missing/slots?date=2026-11-20`)
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ message: 'Тип встречи не найден.' })
})

test.each(['2026-11-21', '2026-11-22'])('the API returns no slots on weekend date %s', async (date) => {
  const baseUrl = await startCalendar()
  const response = await fetch(`${baseUrl}/api/meeting-types/intro/slots?date=${date}`)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ timeZone: 'Europe/Moscow', slots: [] })
})

test('a Guest selects a date and sees slots in Moscow time', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' })
    await page.clock.setFixedTime(now)
    await page.goto(baseUrl)
    await page.getByRole('link', { name: 'Записаться', exact: true }).click()
    await page.getByRole('button', { name: 'Знакомство', exact: true }).click({ timeout: 3_000 })
    const date = page.getByLabel('Дата встречи')
    expect(await date.getAttribute('min')).toBe('2026-11-20')
    expect(await date.getAttribute('max')).toBe('2026-12-03')
    await date.fill('2026-11-20')
    await page.getByText('Время по Москве (Europe/Moscow)', { exact: true }).waitFor()
    await page.getByText('10:00–10:30', { exact: true }).waitFor()
    await page.getByText('17:30–18:00', { exact: true }).waitFor()

    await date.fill('2026-11-21')
    await page.getByText('На эту дату нет свободных слотов.').waitFor()
    expect(await page.getByText('10:00–10:30', { exact: true }).count()).toBe(0)
  } finally {
    await browser.close()
  }
}, 15_000)
