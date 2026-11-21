import GuestBookingList from './GuestBookingList'
import MeetingTypeList from './MeetingTypeList'
import OwnerPage from './OwnerPage'
import { buttonVariants } from './components/ui/button'

const bookingPath = '/book'
const upcomingBookingsPath = '/bookings'
const ownerPath = '/owner'

const destinationTitles: ReadonlyMap<string, string> = new Map([
  [bookingPath, 'Выбор типа встречи'],
  [upcomingBookingsPath, 'Предстоящие записи'],
  [ownerPath, 'Раздел Владельца'],
])

const textLink = 'w-fit rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4'

function App({ pathname = '/' }: { pathname?: string }) {
  const isHome = pathname === '/'
  const currentPath = pathname.replace(/\/$/, '')
  const title = isHome
    ? 'Календарь звонков'
    : destinationTitles.get(currentPath) ?? 'Страница не найдена'

  return (
    <main className="grid min-h-dvh place-items-center bg-muted px-4 py-12">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-6 text-card-foreground shadow-sm sm:p-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {isHome ? (
          <nav aria-label="Действия Гостя" className="mt-8 grid gap-3">
            <a href={bookingPath} className={buttonVariants({ className: 'min-h-11' })}>
              Записаться
            </a>
            <a href={upcomingBookingsPath} className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
              Предстоящие записи
            </a>
            <a href={ownerPath} className={`mt-4 justify-self-center text-sm ${textLink}`}>
              Раздел Владельца
            </a>
          </nav>
        ) : (
          <>
            {currentPath === bookingPath && <MeetingTypeList />}
            {currentPath === upcomingBookingsPath && <GuestBookingList bookingPath={bookingPath} />}
            {currentPath === ownerPath && <OwnerPage />}
            <a href="/" className={`mt-8 inline-block ${textLink}`}>На главную</a>
          </>
        )}
      </section>
    </main>
  )
}

export default App
