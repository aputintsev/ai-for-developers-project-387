import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CreateBooking400FieldErrors } from '../src/api/generated/models/createBooking400FieldErrors.ts'
import type { CreateMeetingType400FieldErrors } from '../src/api/generated/models/createMeetingType400FieldErrors.ts'
import type { MeetingType } from '../src/api/generated/models/meetingType.ts'
import { calendarTimeZone, moscowDate } from '../src/lib/calendar-time.ts'
import { isBookableDate, workingSlots } from './availability.ts'
import { createBookingStore } from './bookings.ts'
import { guestProfileCookie, guestProfileKey, newGuestProfileKey } from './guest-profile.ts'
import { createMeetingTypeStore } from './meeting-types.ts'

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJsonFields(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk)
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return input && typeof input === 'object' ? input : {}
}

const dateTimePattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3}0*)?(?:Z|[+-]\d{2}:\d{2})$/i

function bookingStart(value: unknown) {
  if (typeof value !== 'string' || !dateTimePattern.test(value)) {
    return undefined
  }
  const instant = new Date(value)
  const day = new Date(value.slice(0, 10))
  if (!Number.isFinite(instant.getTime()) || !Number.isFinite(day.getTime())
    || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return undefined
  return instant
}

export function createCalendarApi(
  initialMeetingTypes: readonly MeetingType[] = [],
  now: () => Date = () => new Date(),
) {
  const meetingTypes = createMeetingTypeStore(initialMeetingTypes)
  const bookings = createBookingStore()

  async function createBooking(request: IncomingMessage, response: ServerResponse) {
    const fields = await readJsonFields(request)
    const meetingType = 'meetingTypeId' in fields && typeof fields.meetingTypeId === 'string'
      ? meetingTypes.get(fields.meetingTypeId) : undefined
    const start = bookingStart('start' in fields ? fields.start : undefined)
    const guestName = 'guestName' in fields && typeof fields.guestName === 'string' ? fields.guestName.trim() : ''
    const guestEmail = 'guestEmail' in fields && typeof fields.guestEmail === 'string' ? fields.guestEmail.trim() : ''
    const validEmail = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(guestEmail)
    const date = start ? moscowDate(start) : ''
    const slot = meetingType && start && isBookableDate(date, now())
      ? workingSlots(date, meetingType.durationMinutes).find(({ start: candidate }) => candidate === start.toISOString())
      : undefined

    if (!meetingType || !slot || !guestName || !validEmail) {
      const fieldErrors: CreateBooking400FieldErrors = {}
      if (!meetingType) fieldErrors.meetingTypeId = 'Выберите тип встречи.'
      if (!slot) fieldErrors.start = 'Выберите допустимое время встречи.'
      if (!guestName) fieldErrors.guestName = 'Введите имя.'
      if (!validEmail) fieldErrors.guestEmail = 'Введите корректный email.'
      sendJson(response, 400, { message: 'Проверьте поля формы.', fieldErrors })
      return
    }

    const existingKey = guestProfileKey(request)
    const profileKey = existingKey ?? newGuestProfileKey()
    const booking = bookings.create({ ...slot, meetingType, guestName, guestEmail }, profileKey)
    if (!booking) {
      sendJson(response, 409, { message: 'Это время уже занято. Выберите другое время' })
      return
    }

    if (!existingKey) response.setHeader('Set-Cookie', guestProfileCookie(request, profileKey))
    sendJson(response, 201, booking)
  }

  async function createMeetingType(request: IncomingMessage, response: ServerResponse) {
    const fields = await readJsonFields(request)
    const name = 'name' in fields && typeof fields.name === 'string' ? fields.name.trim() : ''
    const description = 'description' in fields && typeof fields.description === 'string' ? fields.description.trim() : ''
    const durationMinutes = 'durationMinutes' in fields ? fields.durationMinutes : undefined

    const fieldErrors: CreateMeetingType400FieldErrors = {}
    if (!name) fieldErrors.name = 'Введите название.'
    if (!description) fieldErrors.description = 'Введите описание.'
    const validDuration = typeof durationMinutes === 'number'
      && Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 480
    if (!validDuration) fieldErrors.durationMinutes = 'Введите целое число от 1 до 480.'
    if (!name || !description || !validDuration) {
      sendJson(response, 400, { message: 'Проверьте поля формы.', fieldErrors })
      return
    }

    const created = meetingTypes.create({ name, description, durationMinutes })
    if (!created) {
      const message = 'Тип встречи с таким названием уже существует.'
      sendJson(response, 409, { message, fieldErrors: { name: message } })
      return
    }
    sendJson(response, 201, created)
  }

  return function handleCalendarApi(request: IncomingMessage, response: ServerResponse) {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost')
    if (pathname === '/api/guest/bookings' && request.method === 'GET') {
      const profileKey = guestProfileKey(request)
      const upcoming = profileKey ? bookings.listUpcoming(now(), profileKey) : []
      response.setHeader('Cache-Control', 'no-store')
      sendJson(response, 200, upcoming.map(({ id, meetingType, start, end }) => ({
        id, meetingType, start, end,
      })))
      return true
    }
    if (pathname === '/api/owner/bookings' && request.method === 'GET') {
      sendJson(response, 200, bookings.listUpcoming(now()))
      return true
    }

    if (pathname === '/api/bookings' && request.method === 'POST') {
      void createBooking(request, response).catch(() => {
        sendJson(response, 400, { message: 'Не удалось прочитать данные.', fieldErrors: {} })
      })
      return true
    }

    const availabilityRoute = /^\/api\/meeting-types\/([^/]+)\/slots$/.exec(pathname)
    if (request.method === 'GET' && availabilityRoute) {
      const meetingType = meetingTypes.get(availabilityRoute[1])
      const date = searchParams.get('date') ?? ''
      if (!meetingType) {
        sendJson(response, 404, { message: 'Тип встречи не найден.' })
      } else if (!isBookableDate(date, now())) {
        sendJson(response, 400, { message: 'Выберите дату в пределах 14 дней с завтрашнего дня по Москве.' })
      } else {
        sendJson(response, 200, {
          timeZone: calendarTimeZone,
          slots: workingSlots(date, meetingType.durationMinutes).filter(bookings.isFree),
        })
      }
      return true
    }
    if (pathname !== '/api/meeting-types') return false

    if (request.method === 'GET') {
      sendJson(response, 200, meetingTypes.list())
      return true
    }
    if (request.method === 'POST') {
      void createMeetingType(request, response).catch(() => {
        sendJson(response, 400, { message: 'Не удалось прочитать данные.', fieldErrors: {} })
      })
      return true
    }
    return false
  }
}
