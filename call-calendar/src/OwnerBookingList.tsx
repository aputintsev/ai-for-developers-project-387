import { listOwnerBookings } from './api/generated/sdk.gen'
import { calendarTimeZone, moscowDateDetails, moscowTimeRange } from './lib/calendar-time'
import { useRemoteList } from './lib/use-remote-list'

function OwnerBookingList() {
  const [bookings] = useRemoteList(listOwnerBookings)

  return (
    <section aria-labelledby="owner-bookings" className="rounded-xl border bg-muted/40 p-4 sm:p-5">
      <h2 id="owner-bookings" className="text-xl font-semibold">Предстоящие записи</h2>
      {bookings === 'loading' && <p className="mt-3 text-muted-foreground" role="status">Загружаем записи…</p>}
      {bookings === 'error' && <p className="mt-3" role="alert">Не удалось загрузить записи.</p>}
      {Array.isArray(bookings) && (bookings.length === 0 ? (
        <p className="mt-3 text-muted-foreground">Нет предстоящих записей</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Время по Москве ({calendarTimeZone})</p>
          <ul className="mt-3 grid gap-3">
            {bookings.map(({ id, meetingType, start, end, guestName, guestEmail }) => {
              const { date, dateLabel } = moscowDateDetails(start)
              return (
                <li key={id} className="grid gap-1 rounded-lg border p-4 text-sm">
                  <h3 className="text-base font-semibold">{meetingType.name}</h3>
                  <time dateTime={date}>{dateLabel}</time>
                  <p>{moscowTimeRange({ start, end })}</p>
                  <p>{meetingType.durationMinutes} мин</p>
                  <p className="mt-1 wrap-anywhere">{guestName}</p>
                  <p className="wrap-anywhere">{guestEmail}</p>
                </li>
              )
            })}
          </ul>
        </>
      ))}
    </section>
  )
}

export default OwnerBookingList
