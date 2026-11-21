import { afterEach, expect, test, vi } from 'vitest'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { listMeetingTypes } from '../src/api/generated/sdk.gen'
import { createCalendarConfig } from '../vite.config'

const meetingType = {
  id: 'intro',
  name: 'Знакомство',
  description: 'Обсудим ваши цели',
  durationMinutes: 30,
}

let server

async function startCalendar(initialMeetingTypes) {
  server = await createServer({
    ...createCalendarConfig(initialMeetingTypes),
    configFile: false,
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  await server.listen()
  return `http://127.0.0.1:${server.httpServer.address().port}`
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await server?.close()
})

test('the meeting types API returns an empty list for a new calendar', async () => {
  const baseUrl = await startCalendar()
  vi.stubGlobal('location', { origin: baseUrl })
  const { data, status } = await listMeetingTypes()
  expect(status).toBe(200)
  expect(data).toEqual([])
})

test('the meeting types API returns the available meeting types', async () => {
  const baseUrl = await startCalendar([meetingType])
  vi.stubGlobal('location', { origin: baseUrl })
  const { data, status } = await listMeetingTypes()
  expect(status).toBe(200)
  expect(data).toEqual([{
    id: 'intro',
    name: 'Знакомство',
    description: 'Обсудим ваши цели',
    durationMinutes: 30,
  }])
})

test('a Guest can find an available meeting type after choosing to book', async () => {
  const baseUrl = await startCalendar([meetingType])
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const page = await browser.newPage()
    await page.goto(baseUrl)
    await page.getByRole('link', { name: 'Записаться', exact: true }).click()
    await page.getByRole('heading', { name: 'Выбор типа встречи' }).waitFor()
    await page.getByText('Знакомство', { exact: true }).waitFor({ timeout: 3_000 })
    await page.getByText('Обсудим ваши цели', { exact: true }).waitFor()
    await page.getByText('30 мин', { exact: true }).waitFor()
  } finally {
    await browser.close()
  }
}, 30_000)

function postMeetingType(baseUrl, input) {
  return fetch(`${baseUrl}/api/meeting-types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

test('the meeting types API creates a meeting type and publishes it in the list', async () => {
  const baseUrl = await startCalendar()
  vi.stubGlobal('location', { origin: baseUrl })
  const response = await postMeetingType(baseUrl, {
    name: '  Знакомство  ',
    description: 'Обсудим ваши цели',
    durationMinutes: 480,
  })

  expect(response.status).toBe(201)
  const created = await response.json()
  expect(created).toEqual({
    id: expect.any(String),
    name: 'Знакомство',
    description: 'Обсудим ваши цели',
    durationMinutes: 480,
  })
  expect(created.id).not.toBe('')
  const { data } = await listMeetingTypes()
  expect(data).toEqual([created])
})

test.each([
  { input: { name: ' ', description: '', durationMinutes: '' }, fields: ['name', 'description', 'durationMinutes'] },
  { input: { name: 'Знакомство', description: 'Описание', durationMinutes: 0 }, fields: ['durationMinutes'] },
  { input: { name: 'Знакомство', description: 'Описание', durationMinutes: 481 }, fields: ['durationMinutes'] },
  { input: { name: 'Знакомство', description: 'Описание', durationMinutes: 1.5 }, fields: ['durationMinutes'] },
])('the meeting types API rejects invalid input $input', async ({ input, fields }) => {
  const baseUrl = await startCalendar()
  const response = await postMeetingType(baseUrl, input)
  expect(response.status).toBe(400)
  const error = await response.json()
  expect(error.message).toMatch(/\S/)
  expect(error.fieldErrors).toEqual(Object.fromEntries(fields.map((field) => [field, expect.stringMatching(/\S/)])))
  expect(await (await fetch(`${baseUrl}/api/meeting-types`)).json()).toEqual([])
})

test('the meeting types API rejects a duplicate name regardless of case and surrounding whitespace', async () => {
  const baseUrl = await startCalendar([meetingType])
  const response = await postMeetingType(baseUrl, {
    name: '  ЗНАКОМСТВО  ',
    description: 'Другое описание',
    durationMinutes: 1,
  })
  expect(response.status).toBe(409)
  const error = await response.json()
  expect(error.message).toMatch(/\S/)
  expect(error.fieldErrors).toEqual({ name: expect.stringMatching(/\S/) })
  expect(await (await fetch(`${baseUrl}/api/meeting-types`)).json()).toEqual([meetingType])
})

test('the Owner creates a meeting type and both the Owner and Guest can see it', async () => {
  const baseUrl = await startCalendar()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL })
  try {
    const page = await browser.newPage()
    await page.goto(baseUrl)
    await page.getByRole('link', { name: 'Раздел Владельца' }).click()
    await page.getByText('Типов встреч пока нет.').waitFor()
    await page.getByLabel('Название', { exact: true }).fill('Знакомство')
    await page.getByLabel('Описание', { exact: true }).fill('Обсудим ваши цели')
    await page.getByLabel('Длительность, мин').fill('30')
    await page.getByRole('button', { name: 'Создать тип встречи' }).click()

    const ownerMeeting = page.getByRole('listitem').filter({ hasText: 'Знакомство' })
    await ownerMeeting.getByText('Обсудим ваши цели', { exact: true }).waitFor()
    await ownerMeeting.getByText('30 мин', { exact: true }).waitFor()

    await page.getByRole('link', { name: 'На главную' }).click()
    await page.getByRole('link', { name: 'Записаться', exact: true }).click()
    const guestMeeting = page.getByRole('listitem').filter({ hasText: 'Знакомство' })
    await guestMeeting.getByText('Обсудим ваши цели', { exact: true }).waitFor()
    await guestMeeting.getByText('30 мин', { exact: true }).waitFor()
  } finally {
    await browser.close()
  }
}, 15_000)
