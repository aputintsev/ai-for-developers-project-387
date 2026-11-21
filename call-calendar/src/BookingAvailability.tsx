import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createBooking, listSlots } from './api/generated/sdk.gen'
import type { Booking } from './api/generated/models/booking'
import type { CreateBooking400FieldErrors } from './api/generated/models/createBooking400FieldErrors'
import type { MeetingType } from './api/generated/models/meetingType'
import type { Slot } from './api/generated/models/slot'
import { Button, buttonVariants } from './components/ui/button'
import { bookingWindow, calendarTimeZone, moscowDateDetails, moscowTimeRange } from './lib/calendar-time'

const inputClass = 'min-h-11 rounded-md border bg-background px-3'

function focusConflictMessage(element: HTMLParagraphElement | null) {
  element?.focus()
}

function BookingDetails({ meetingType, slot }: { meetingType: MeetingType; slot: Slot }) {
  const { date, dateLabel } = moscowDateDetails(slot.start)
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-muted-foreground">Тип встречи</dt>
      <dd>{meetingType.name}</dd>
      <dt className="text-muted-foreground">Дата</dt>
      <dd><time dateTime={date}>{dateLabel}</time></dd>
      <dt className="text-muted-foreground">Время по Москве ({calendarTimeZone})</dt>
      <dd>{moscowTimeRange(slot)}</dd>
    </dl>
  )
}

type BookingSubmission = {
  submitting: boolean
  setSubmitting: (submitting: boolean) => void
}

function BookingDay({ meetingType, date, submitting, setSubmitting }: BookingSubmission & {
  meetingType: MeetingType
  date: string
}) {
  const [availability, setAvailability] = useState<Slot[] | 'loading' | string>('loading')
  const [revision, setRevision] = useState(0)
  const [slot, setSlot] = useState<Slot>()
  const [booking, setBooking] = useState<Booking>()
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [message, setMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<CreateBooking400FieldErrors>({})
  const meetingTypeId = meetingType.id

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const { data, status } = await listSlots(meetingTypeId, { date }, { signal: controller.signal })
        if (!controller.signal.aborted) setAvailability(status === 200 ? data.slots : data.message)
      } catch {
        if (!controller.signal.aborted) setAvailability('Не удалось загрузить свободные слоты.')
      }
    }

    void load()
    return () => controller.abort()
  }, [meetingTypeId, date, revision])

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!slot || submitting) return

    setSubmitting(true)
    setMessage('')
    setFieldErrors({})
    try {
      const submit = () => createBooking({ meetingTypeId, start: slot.start, guestName, guestEmail })
      // Let the first response set the Guest profile cookie before another tab submits.
      const { status, data } = await (navigator.locks
        ? navigator.locks.request('calendar-guest-booking', submit)
        : submit())
      if (status === 201) {
        setBooking(data)
      } else {
        setMessage(data.message)
        if (status === 409) {
          setSlot(undefined)
          setAvailability('loading')
          setRevision((current) => current + 1)
        } else {
          setFieldErrors(data.fieldErrors)
        }
      }
    } catch {
      setMessage('Не удалось подтвердить запись.')
    } finally {
      setSubmitting(false)
    }
  }

  if (booking) {
    return (
      <section aria-labelledby="booking-confirmed" className="grid gap-4 rounded-lg border p-4">
        <h2 id="booking-confirmed" className="text-xl font-semibold" tabIndex={-1} ref={(heading) => heading?.focus()}>
          Вы записаны
        </h2>
        <BookingDetails meetingType={booking.meetingType} slot={booking} />
        <a href="/bookings" className={buttonVariants({ className: 'w-fit' })}>Предстоящие записи</a>
      </section>
    )
  }

  return (
    <>
      {message && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
          tabIndex={slot ? undefined : -1}
          ref={slot ? undefined : focusConflictMessage}
        >
          {message}
        </p>
      )}
      {slot ? (
        <form aria-labelledby="booking-form" className="grid gap-4 rounded-lg border p-4" onSubmit={confirm} noValidate>
          <h2 id="booking-form" className="text-lg font-semibold">Подтверждение записи</h2>
          <BookingDetails meetingType={meetingType} slot={slot} />
          {fieldErrors.start && <p>{fieldErrors.start}</p>}
          {fieldErrors.meetingTypeId && <p>{fieldErrors.meetingTypeId}</p>}
          <label className="grid gap-1 text-sm font-medium">
            Имя
            <input
              className={inputClass}
              value={guestName}
              onChange={(event) => setGuestName(event.currentTarget.value)}
              autoComplete="name"
              required
              disabled={submitting}
              aria-invalid={Boolean(fieldErrors.guestName)}
              aria-describedby={fieldErrors.guestName ? 'booking-name-error' : undefined}
            />
          </label>
          {fieldErrors.guestName && <p id="booking-name-error" className="text-sm text-destructive">{fieldErrors.guestName}</p>}
          <label className="grid gap-1 text-sm font-medium">
            Email
            <input
              className={inputClass}
              type="email"
              value={guestEmail}
              onChange={(event) => setGuestEmail(event.currentTarget.value)}
              autoComplete="email"
              required
              disabled={submitting}
              aria-invalid={Boolean(fieldErrors.guestEmail)}
              aria-describedby={fieldErrors.guestEmail ? 'booking-email-error' : undefined}
            />
          </label>
          {fieldErrors.guestEmail && <p id="booking-email-error" className="text-sm text-destructive">{fieldErrors.guestEmail}</p>}
          <Button type="submit" disabled={submitting}>Подтвердить запись</Button>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => {
            setSlot(undefined)
            setMessage('')
            setFieldErrors({})
          }}>Выбрать другое время</Button>
        </form>
      ) : (
        <AvailableSlots availability={availability} onSelect={(nextSlot) => {
          setSlot(nextSlot)
          setMessage('')
        }} />
      )}
    </>
  )
}

function AvailableSlots({ availability, onSelect }: {
  availability: Slot[] | 'loading' | string
  onSelect: (slot: Slot) => void
}) {
  if (availability === 'loading') return <p role="status">Загружаем свободные слоты…</p>
  if (typeof availability === 'string') return <p role="alert">{availability}</p>
  if (!availability.length) return <p role="status">На эту дату нет свободных слотов.</p>

  return (
    <ul aria-label="Свободные слоты" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {availability.map((slot) => (
        <li key={slot.start}>
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => onSelect(slot)}>
            {moscowTimeRange(slot)}
          </Button>
        </li>
      ))}
    </ul>
  )
}

export default function BookingAvailability({ meetingType, submitting, setSubmitting }: BookingSubmission & {
  meetingType: MeetingType
}) {
  const [date, setDate] = useState('')
  const { first, last } = bookingWindow(new Date())

  return (
    <section className="mt-6 grid gap-3 border-t pt-6">
      <label className="grid w-fit gap-2 text-sm font-medium">
        Дата встречи
        <input
          type="date"
          className={inputClass}
          min={first}
          max={last}
          value={date}
          disabled={submitting}
          onChange={(event) => setDate(event.currentTarget.value)}
        />
      </label>
      <p className="text-sm text-muted-foreground">Время по Москве ({calendarTimeZone})</p>
      {date && (
        <BookingDay
          key={date}
          meetingType={meetingType}
          date={date}
          submitting={submitting}
          setSubmitting={setSubmitting}
        />
      )}
    </section>
  )
}
