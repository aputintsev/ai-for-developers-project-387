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
const now = new Date('2026-11-18T21:30:00Z')
const start = '2026-11-20T07:00:00.000Z'
const guest = { guestName: 'Анна', guestEmail: 'anna@example.com' }
const conflictMessage = 'Это время уже занято. Выберите другое время'
let server

async function startCalendar(meetingTypes = [intro, followUp]) {
  server = await createServer({
    ...createCalendarConfig(meetingTypes, () => now),
    configFile: false,
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  await server.listen()
  return `http://127.0.0.1:${server.httpServer.address().port}`
}

function book(baseUrl, input) {
  return fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

afterEach(async () => {
  await server?.close()
})

test('only one concurrent request can book partially overlapping slots across meeting types', async () => {
  const types = [{ ...intro, durationMinutes: 60 }, { ...followUp, durationMinutes: 30 }]
  const baseUrl = await startCalendar(types)
  const requests = [
    { ...guest, meetingTypeId: intro.id, start },
    { ...guest, meetingTypeId: followUp.id, start: '2026-11-20T07:30:00.000Z' },
  ]
  const responses = await Promise.all(requests.map((input) => book(baseUrl, input)))
  expect(responses.map(({ status }) => status).sort()).toEqual([201, 409])

  const winner = responses.findIndex(({ status }) => status === 201)
  const booking = await responses[winner].json()
  expect(booking).toEqual({
    ...guest,
    id: expect.any(String),
    meetingType: types[winner],
    start: requests[winner].start,
    end: '2026-11-20T08:00:00.000Z',
  })
  expect(await responses[1 - winner].json()).toEqual({ message: conflictMessage })

  const slotsResponse = await fetch(`${baseUrl}/api/meeting-types/intro/slots?date=2026-11-20`)
  expect(slotsResponse.status).toBe(200)
  const { slots } = await slotsResponse.json()
  expect(slots[0]).toEqual({ start: '2026-11-20T08:00:00.000Z', end: '2026-11-20T09:00:00.000Z' })

  const adjacent = await book(baseUrl, { ...guest, meetingTypeId: intro.id, start: booking.end })
  expect(adjacent.status).toBe(201)
  expect(await adjacent.json()).toMatchObject({ start: booking.end, end: '2026-11-20T09:00:00.000Z' })
})

test('rejects a second booking across meeting types at the same start time', async () => {
  const baseUrl = await startCalendar()
  const first = await book(baseUrl, { ...guest, meetingTypeId: intro.id, start })
  expect(first.status).toBe(201)
  const duplicate = await book(baseUrl, { ...guest, meetingTypeId: followUp.id, start })
  expect(duplicate.status).toBe(409)
  expect(await duplicate.json()).toEqual({ message: conflictMessage })
})

test('the API reports invalid contact fields and rejects out-of-window and off-hours starts', async () => {
  const baseUrl = await startCalendar()
  const input = { ...guest, meetingTypeId: intro.id, start }
  const invalidGuest = await book(baseUrl, { ...input, guestName: '  ', guestEmail: 'anna' })
  expect(invalidGuest.status).toBe(400)
  expect(await invalidGuest.json()).toEqual({
    message: 'Проверьте поля формы.',
    fieldErrors: { guestName: 'Введите имя.', guestEmail: 'Введите корректный email.' },
  })

  for (const invalidStart of [
    'invalid',
    '2026-11-19T07:00:00.000Z',
    '2026-12-04T07:00:00.000Z',
    '2026-11-21T07:00:00.000Z',
    '2026-11-20T06:45:00.000Z',
    '2026-11-20T07:01:00.000Z',
    '2026-11-20T14:45:00.000Z',
  ]) {
    const response = await book(baseUrl, { ...input, start: invalidStart })
    expect(response.status, invalidStart).toBe(400)
    expect(await response.json()).toEqual({
      message: 'Проверьте поля формы.',
      fieldErrors: { start: 'Выберите допустимое время встречи.' },
    })
  }
})

test('a Guest keeps contact details after a slot conflict and confirms a new time', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' })
    await page.clock.setFixedTime(now)
    await page.goto(baseUrl)
    await page.getByRole('link', { name: 'Записаться', exact: true }).click()
    await page.getByRole('button', { name: intro.name, exact: true }).click()
    await page.getByLabel('Дата встречи').fill('2026-11-20')
    await page.getByRole('button', { name: '10:00–10:30' }).click({ timeout: 3_000 })

    const form = page.getByRole('form', { name: 'Подтверждение записи' })
    await form.getByText(intro.name, { exact: true }).waitFor()
    await form.getByText('20.11.2026', { exact: true }).waitFor()
    await form.getByText('10:00–10:30', { exact: true }).waitFor()
    await form.getByText('Время по Москве (Europe/Moscow)', { exact: true }).waitFor()

    const confirm = form.getByRole('button', { name: 'Подтвердить запись' })
    const name = form.getByLabel('Имя', { exact: true })
    const email = form.getByLabel('Email', { exact: true })
    await confirm.click()
    await form.getByText('Введите имя.', { exact: true }).waitFor()
    await form.getByText('Введите корректный email.', { exact: true }).waitFor()
    await name.fill(guest.guestName)
    await email.fill(guest.guestEmail)

    const competing = await book(baseUrl, { ...guest, meetingTypeId: intro.id, start })
    expect(competing.status).toBe(201)
    const pending = Promise.withResolvers()
    const release = Promise.withResolvers()
    await page.route('**/api/bookings', async (route) => {
      pending.resolve()
      await release.promise
      await route.continue()
    }, { times: 1 })

    await confirm.click()
    await pending.promise
    const dateControl = page.getByLabel('Дата встречи')
    const typeControl = page.getByRole('button', { name: followUp.name, exact: true })
    try {
      expect(await dateControl.isDisabled()).toBe(true)
      expect(await typeControl.isDisabled()).toBe(true)
    } finally {
      release.resolve()
    }

    await page.getByText(conflictMessage, { exact: true }).waitFor()
    expect(await dateControl.isEnabled()).toBe(true)
    expect(await typeControl.isEnabled()).toBe(true)
    const nextSlot = page.getByRole('button', { name: '10:30–11:00' })
    await nextSlot.waitFor()
    expect(await page.getByRole('button', { name: '10:00–10:30' }).count()).toBe(0)

    await nextSlot.click()
    expect(await name.inputValue()).toBe(guest.guestName)
    expect(await email.inputValue()).toBe(guest.guestEmail)
    await confirm.click()
    const confirmation = page.getByRole('region', { name: 'Вы записаны' })
    await confirmation.getByText(intro.name, { exact: true }).waitFor()
    await confirmation.getByText('20.11.2026', { exact: true }).waitFor()
    await confirmation.getByText('10:30–11:00', { exact: true }).waitFor()
    expect(await confirmation.getByRole('link', { name: 'Предстоящие записи' }).getAttribute('href'))
      .toBe('/bookings')
  } finally {
    await browser.close()
  }
}, 15_000)

test('a slot conflict brings the message into view after another Guest books the same time', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const first = await browser.newPage({ viewport: { width: 375, height: 500 } })
    const second = await browser.newPage()
    for (const page of [first, second]) {
      await page.clock.setFixedTime(now)
      await page.goto(`${baseUrl}/book`)
      await page.getByRole('button', { name: intro.name, exact: true }).click()
      await page.getByLabel('Дата встречи').fill('2026-11-20')
      await page.getByRole('button', { name: '10:00–10:30' }).click()
      await page.getByLabel('Имя', { exact: true }).fill(guest.guestName)
      await page.getByLabel('Email', { exact: true }).fill(guest.guestEmail)
    }

    await second.getByRole('button', { name: 'Подтвердить запись' }).click()
    await second.getByRole('heading', { name: 'Вы записаны' }).waitFor()

    const confirm = first.getByRole('button', { name: 'Подтвердить запись' })
    await confirm.evaluate((button) => button.scrollIntoView({ block: 'center' }))
    await confirm.click()
    await first.getByRole('button', { name: '10:30–11:00' }).waitFor()
    const alert = first.getByRole('alert').filter({ hasText: conflictMessage })
    await alert.waitFor()
    const { y, height } = await alert.boundingBox()
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y + height).toBeLessThanOrEqual(first.viewportSize().height)
  } finally {
    await browser.close()
  }
}, 15_000)

test('two fresh tabs keep both bookings in the same Guest profile', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const context = await browser.newContext()
    const [first, second] = await Promise.all([context.newPage(), context.newPage()])
    await Promise.all([first, second].map(async (page, index) => {
      await page.clock.setFixedTime(now)
      await page.goto(`${baseUrl}/book`)
      await page.getByRole('button', { name: intro.name, exact: true }).click()
      await page.getByLabel('Дата встречи').fill('2026-11-20')
      await page.getByRole('button', { name: index === 0 ? '10:00–10:30' : '10:30–11:00' }).click()
      await page.getByLabel('Имя', { exact: true }).fill(guest.guestName)
      await page.getByLabel('Email', { exact: true }).fill(guest.guestEmail)
    }))

    const firstRequest = Promise.withResolvers()
    const releaseFirstResponse = Promise.withResolvers()
    await first.route('**/api/bookings', async (route) => {
      const response = await fetch(route.request().url(), {
        method: 'POST',
        headers: await route.request().allHeaders(),
        body: route.request().postData(),
      })
      firstRequest.resolve()
      await releaseFirstResponse.promise
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      })
    })

    await first.getByRole('button', { name: 'Подтвердить запись' }).click()
    await firstRequest.promise
    try {
      const secondRequest = second.waitForRequest('**/api/bookings', { timeout: 500 })
      await second.getByRole('button', { name: 'Подтвердить запись' }).click()
      // Let an uncoordinated second request complete before releasing the first.
      await secondRequest.then(() => second.getByRole('heading', { name: 'Вы записаны' }).waitFor(), () => {})
    } finally {
      releaseFirstResponse.resolve()
    }

    await Promise.all([first, second].map(async (page) => {
      await page.getByRole('heading', { name: 'Вы записаны' }).waitFor()
      await page.getByRole('link', { name: 'Предстоящие записи' }).click()
      await page.getByText('10:00–10:30', { exact: true }).waitFor({ timeout: 3_000 })
      await page.getByText('10:30–11:00', { exact: true }).waitFor({ timeout: 3_000 })
    }))
  } finally {
    await browser.close()
  }
}, 15_000)
