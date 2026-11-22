import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [checkout, revision, expectedSha, output] = process.argv.slice(2)
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
const sha = git('rev-parse', 'HEAD')
assert.equal(sha, expectedSha)
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
console.log(revision, sha)
const app = join(checkout, 'call-calendar')
process.chdir(app)
const fromApp = (path) => import(pathToFileURL(join(app, path)))
const { chromium } = await fromApp('node_modules/playwright/index.mjs')
const { createServer } = await fromApp('node_modules/vite/dist/node/index.js')
const { createCalendarConfig } = await fromApp('vite.config.ts')

const now = new Date('2026-11-18T21:30:00Z')
const day = '2026-11-20'
const nextDay = '2026-11-23'
const meeting = { id: 'review', name: 'Контрольная встреча', description: 'Браузерная проверка PR #37', durationMinutes: 30 }
const guest = { guestName: 'Анна', guestEmail: 'anna@example.com', topic: 'План встречи' }
const conflict = 'Это время уже занято. Выберите другое время'
const browser = await chromium.launch()

const formOn = page => page.getByRole('form', { name: 'Подтверждение записи' })
const topicOn = form => form.getByLabel('Тема разговора', { exact: true })
const nameOn = form => form.getByLabel('Имя', { exact: true })
const emailOn = form => form.getByLabel('Email', { exact: true })
const slotOn = (page, time) => page.getByRole('button', { name: time, exact: true })
const textOn = (page, value) => page.getByText(value, { exact: true })
const confirm = form => form.getByRole('button', { name: 'Подтвердить запись' }).click()

async function openBooking(page, baseUrl, time) {
  await page.goto(baseUrl)
  await page.getByRole('link', { name: 'Записаться', exact: true }).click()
  await page.getByRole('button', { name: meeting.name, exact: true }).click()
  await page.getByLabel('Дата встречи').fill(day)
  await slotOn(page, time).click()
  const form = formOn(page)
  await form.waitFor()
  return form
}

async function fillContact(form) {
  await nameOn(form).fill(guest.guestName)
  await emailOn(form).fill(guest.guestEmail)
}

async function takeSlot(baseUrl) {
  const result = await fetch(new URL('/api/bookings', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingTypeId: meeting.id, start: day + 'T07:00:00.000Z',
      guestName: 'Иван', guestEmail: 'ivan@example.com', topic: 'Занятый слот',
    }),
  })
  assert.equal(result.status, 201, await result.text())
}

const scenarios = [
  {
    name: 'topic-in-booking-and-lists',
    duration: 30,
    expectedFailure: revision === 'base' ? 'Booking topic field is absent' : undefined,
    async run({ page, baseUrl, screenshot }) {
      const form = await openBooking(page, baseUrl, '10:00–10:30')
      const topic = topicOn(form)
      assert.equal(await topic.count(), 1, 'Booking topic field is absent')
      assert.equal(await topic.getAttribute('maxlength'), '100')
      assert.equal(await topic.evaluate(input => input.required), true)
      assert.equal(await textOn(form, 'Тема').count(), 0)
      await fillContact(form)
      await topic.fill('   ')
      await confirm(form)
      await textOn(form, 'Введите тему разговора.').waitFor()
      await topic.fill('  ' + guest.topic + '  ')
      await confirm(form)
      const confirmed = page.getByRole('region', { name: 'Вы записаны' })
      await textOn(confirmed, guest.topic).waitFor()
      await screenshot('confirmation')
      await confirmed.getByRole('link', { name: 'Предстоящие записи' }).click()
      await textOn(page.getByRole('listitem'), guest.topic).waitFor()
      await screenshot('guest-list')

      const otherPage = await browser.newPage()
      try {
        await otherPage.goto(new URL('/bookings', baseUrl).href)
        await textOn(otherPage, 'У вас нет предстоящих записей').waitFor()
        assert.equal(await textOn(otherPage, guest.topic).count(), 0)
      } finally {
        await otherPage.close()
      }

      await page.getByRole('link', { name: 'На главную' }).click()
      await page.getByRole('link', { name: 'Раздел Владельца' }).click()
      const ownerList = page.getByRole('region', { name: 'Предстоящие записи' })
      await textOn(ownerList.getByRole('listitem'), guest.topic).waitFor()
      await screenshot('owner-list')
    },
  },
  {
    name: 'same-day-conflict',
    duration: 30,
    async run({ page, baseUrl, screenshot }) {
      const form = await openBooking(page, baseUrl, '10:00–10:30')
      await fillContact(form)
      if (await topicOn(form).count()) await topicOn(form).fill(guest.topic)
      await takeSlot(baseUrl)
      await confirm(form)
      await textOn(page.getByRole('alert'), conflict).waitFor()
      const next = slotOn(page, '10:30–11:00')
      await next.waitFor()
      assert.equal(await slotOn(page, '10:00–10:30').count(), 0)
      await next.click()
      assert.equal(await nameOn(form).inputValue(), guest.guestName)
      assert.equal(await emailOn(form).inputValue(), guest.guestEmail)
      if (await topicOn(form).count()) assert.equal(await topicOn(form).inputValue(), guest.topic)
      await confirm(form)
      await textOn(page.getByRole('region', { name: 'Вы записаны' }), '10:30–11:00').waitFor()
      await screenshot('confirmation')
    },
  },
  {
    name: 'last-slot-conflict-and-date-change',
    duration: 480,
    expectedFailure: revision === 'before-fix' ? 'Draft topic was lost after changing date' : undefined,
    async run({ page, baseUrl, screenshot }) {
      const form = await openBooking(page, baseUrl, '10:00–18:00')
      await fillContact(form)
      await topicOn(form).fill(guest.topic)
      await takeSlot(baseUrl)
      await confirm(form)
      await textOn(page.getByRole('alert'), conflict).waitFor()
      await textOn(page, 'На эту дату нет свободных слотов.').waitFor()
      await screenshot('no-slots')
      await page.getByLabel('Дата встречи').fill(nextDay)
      await slotOn(page, '10:00–18:00').waitFor()
      assert.equal(await form.count(), 0)
      await slotOn(page, '10:00–18:00').click()
      await screenshot('draft-on-new-date')
      assert.equal(await topicOn(form).inputValue(), guest.topic, 'Draft topic was lost after changing date')
      assert.equal(await nameOn(form).inputValue(), guest.guestName)
      assert.equal(await emailOn(form).inputValue(), guest.guestEmail)
      await confirm(form)
      const confirmed = page.getByRole('region', { name: 'Вы записаны' })
      await textOn(confirmed, guest.topic).waitFor()
      await textOn(confirmed, '23.11.2026').waitFor()
      await screenshot('confirmation')
    },
  },
]

const results = []
try {
  for (const scenario of scenarios) {
    if (revision === 'base' && scenario.duration === 480) continue
    const server = await createServer({
      ...createCalendarConfig([{ ...meeting, durationMinutes: scenario.duration }], () => now),
      configFile: false,
      server: { host: '127.0.0.1', port: 0, open: false },
    })
    await server.listen()
    const baseUrl = 'http://127.0.0.1:' + server.httpServer.address().port
    const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' })
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const page = await context.newPage()
    page.setDefaultTimeout(7000)
    await page.clock.setFixedTime(now)
    const prefix = join(output, revision + '-' + scenario.name)
    const screenshot = (name) => page.screenshot({ path: prefix + '-' + name + '.png', fullPage: true })
    const result = { scenario: scenario.name, status: 'passed' }
    try {
      await scenario.run({ page, baseUrl, screenshot })
      if (scenario.expectedFailure) {
        result.status = 'failed'
        result.detail = 'Expected failure did not reproduce'
      }
    } catch (error) {
      result.detail = String(error)
      result.status = scenario.expectedFailure && error instanceof assert.AssertionError && error.message.startsWith(scenario.expectedFailure) ? 'expected-failure' : 'failed'
      await screenshot('failure')
    } finally {
      await context.tracing.stop({ path: prefix + '.zip' })
      await context.close()
      await server.close()
    }
    results.push(result)
    console.log(JSON.stringify(result))
  }
} finally {
  await browser.close()
  await writeFile(join(output, revision + '-results.json'), JSON.stringify({
    revision, sha, browser: browser.version(), node: process.version, results,
  }, null, 2) + '\n')
}
if (results.some(result => result.status === 'failed')) process.exitCode = 1
