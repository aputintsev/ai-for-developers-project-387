import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createCalendarConfig } from './vite.config.ts'

const [revision, requestedSha, outputPath, workflowUrl] = process.argv.slice(2)
const output = resolve(outputPath)
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
await mkdir(output, { recursive: true })
assert.equal(sha, requestedSha, 'Checked-out SHA must match the requested revision')
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }), '')

const now = new Date('2026-11-18T21:30:00Z')
const meeting = { id: 'review-meeting', name: 'Проверка записи', description: 'Браузерная проверка' }
const guest = { topic: 'Обсудить план проекта', guestName: 'Анна', guestEmail: 'anna@example.com' }
const date = '2026-11-20'
const nextDate = '2026-11-23'
const conflictMessage = 'Это время уже занято. Выберите другое время'
const browser = await chromium.launch()
const browserVersion = browser.version()
const results = []

async function verify(id, durationMinutes, expected, flow) {
  const server = await createServer({
    ...createCalendarConfig([{ ...meeting, durationMinutes }], () => now),
    configFile: false,
    server: { host: '127.0.0.1', port: 0 },
  })
  try {
    await server.listen()
    const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
    const context = await browser.newContext()
    try {
      await context.tracing.start({ screenshots: true, snapshots: true })
      const page = await context.newPage()
      page.setDefaultTimeout(8_000)
      await page.clock.setFixedTime(now)
      let actual = 'passed'
      let detail
      try {
        await flow(page, baseUrl)
      } catch (error) {
        actual = error instanceof ObservedRegression ? error.code : 'unexpected-error'
        detail = String(error.stack ?? error)
      } finally {
        await page.screenshot({ path: join(output, `${id}.png`), fullPage: true })
        await context.tracing.stop({ path: join(output, `${id}.zip`) })
      }
      results.push({ id, expected, actual, matched: actual === expected, detail })
    } finally {
      await context.close()
    }
  } finally {
    await server.close()
  }
}

class ObservedRegression extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function form(page) {
  return page.getByRole('form', { name: 'Подтверждение записи' })
}

function dateControl(page) {
  return page.getByLabel('Дата встречи')
}

function slot(page, label) {
  return page.getByRole('button', { name: label, exact: true })
}

async function choose(page, baseUrl, label) {
  await page.goto(baseUrl)
  await page.getByRole('link', { name: 'Записаться', exact: true }).click()
  await page.getByRole('button', { name: meeting.name, exact: true }).click()
  await dateControl(page).fill(date)
  await slot(page, label).click()
  await form(page).waitFor()
}

function fields(page) {
  return {
    guestName: form(page).getByLabel('Имя', { exact: true }),
    guestEmail: form(page).getByLabel('Email', { exact: true }),
    topic: form(page).getByLabel('Тема разговора', { exact: true }),
  }
}

async function fillGuest(page, hasTopic) {
  const inputs = fields(page)
  await inputs.guestName.fill(guest.guestName)
  await inputs.guestEmail.fill(guest.guestEmail)
  if (hasTopic) await inputs.topic.fill(guest.topic)
}

async function submit(page, status) {
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/bookings') && response.request().method() === 'POST'),
    form(page).getByRole('button', { name: 'Подтвердить запись' }).click(),
  ])
  assert.equal(response.status(), status)
  return response.json()
}

async function confirmation(page, hasTopic, dateLabel, slotLabel) {
  const confirmed = page.getByRole('region', { name: 'Вы записаны' })
  await confirmed.getByText(dateLabel, { exact: true }).waitFor()
  await confirmed.getByText(slotLabel, { exact: true }).waitFor()
  if (hasTopic) await confirmed.getByText(guest.topic, { exact: true }).waitFor()
  return confirmed
}

async function verifyMain(page, baseUrl) {
  await choose(page, baseUrl, '10:00–10:30')
  if (await fields(page).topic.count() === 0) {
    throw new ObservedRegression('topic-field-missing', 'The booking form has no conversation topic field')
  }
  assert.equal(await form(page).getByText('Тема', { exact: true }).count(), 0)
  assert.equal(await fields(page).topic.getAttribute('maxlength'), '100')
  await fillGuest(page, true)
  const booked = await submit(page, 201)
  assert.equal(booked.topic, guest.topic)
  const confirmed = await confirmation(page, true, '20.11.2026', '10:00–10:30')
  await page.screenshot({ path: join(output, 'main-confirmation.png'), fullPage: true })
  await confirmed.getByRole('link', { name: 'Предстоящие записи' }).click()
  await page.getByText(guest.topic, { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'main-guest-list.png'), fullPage: true })
  await page.goto(`${baseUrl}/owner`)
  await page.getByText(guest.topic, { exact: true }).waitFor()
}

async function verifyConflict(page, baseUrl, acrossDates) {
  const firstSlot = acrossDates ? '10:00–18:00' : '10:00–10:30'
  const hasTopic = revision !== 'before-feature'
  await choose(page, baseUrl, firstSlot)
  await fillGuest(page, hasTopic)

  // A second Guest has a separate cookie jar from the page.
  const competing = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      meetingTypeId: meeting.id, start: `${date}T07:00:00.000Z`,
      guestName: 'Второй гость', guestEmail: 'other@example.com', topic: 'Занять выбранное время',
    }),
  })
  assert.equal(competing.status, 201)
  await submit(page, 409)
  await page.getByText(conflictMessage, { exact: true }).waitFor()
  await slot(page, firstSlot).waitFor({ state: 'hidden' })
  const replacement = acrossDates ? firstSlot : '10:30–11:00'
  if (acrossDates) {
    await dateControl(page).fill(nextDate)
    await slot(page, replacement).waitFor()
    assert.equal(await form(page).count(), 0, 'Previous slot must not carry over')
  }
  await slot(page, replacement).click()
  const inputs = fields(page)
  const observed = {
    guestName: await inputs.guestName.inputValue(),
    guestEmail: await inputs.guestEmail.inputValue(),
  }
  const expected = { guestName: guest.guestName, guestEmail: guest.guestEmail }
  if (hasTopic) {
    observed.topic = await inputs.topic.inputValue()
    expected.topic = guest.topic
  }
  if (acrossDates && Object.values(observed).every((value) => value === '')) {
    throw new ObservedRegression('draft-lost-after-date-change', 'Topic, name and email were all cleared')
  }
  assert.deepEqual(observed, expected)
  await submit(page, 201)
  await confirmation(page, hasTopic, acrossDates ? '23.11.2026' : '20.11.2026', replacement)
}

try {
  await verify('main', 30, revision === 'before-feature' ? 'topic-field-missing' : 'passed', verifyMain)
  await verify('neighbor-same-day-conflict', 30, 'passed', (page, url) => verifyConflict(page, url, false))
  if (revision !== 'before-feature') {
    await verify('regression-date-change-after-conflict', 480,
      revision === 'before-fix' ? 'draft-lost-after-date-change' : 'passed',
      (page, url) => verifyConflict(page, url, true))
  }
} finally {
  await browser.close()
}

const matched = results.every((result) => result.matched)
const report = {
  pullRequest: 'https://github.com/aputintsev/ai-for-developers-project-387/pull/37',
  specification: 'https://github.com/aputintsev/ai-for-developers-project-387/issues/21',
  revision, requestedSha, actualHead: sha, workflowUrl, browser: `Chromium ${browserVersion}`,
  result: matched ? 'expected-results-confirmed' : 'failed', scenarios: results,
}
await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
const summary = [
  `# Independent browser verification — ${revision}`,
  '',
  `PR #37 · Specification #21 · Chromium ${browserVersion}`,
  '',
  `Requested SHA: \`${requestedSha}\``,
  `\ngit rev-parse HEAD: \`${sha}\``,
  `\nResult: **${report.result}**`,
  '\n| Scenario | Expected | Observed | Trace | Screenshot |',
  '|---|---|---|---|---|',
  ...results.map(({ id, expected, actual }) => `| ${id} | ${expected} | ${actual} | [trace](${id}.zip) | [image](${id}.png) |`),
  '',
  workflowUrl || 'Local validation',
  '',
].join('\n')
await writeFile(join(output, 'report.md'), summary)
console.log(summary)
if (!matched) {
  for (const result of results.filter((result) => !result.matched)) console.error(result.detail)
  process.exitCode = 1
}
