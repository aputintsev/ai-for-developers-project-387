import { useState } from 'react'
import BookingAvailability from './BookingAvailability'
import CreateMeetingTypeForm from './CreateMeetingTypeForm'
import { listMeetingTypes } from './api/generated/sdk.gen'
import { useRemoteList } from './lib/use-remote-list'

function MeetingTypeList({ allowCreation = false }: { allowCreation?: boolean }) {
  const [selectedId, setSelectedId] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [meetingTypes, setMeetingTypes] = useRemoteList(listMeetingTypes)

  const selectedType = Array.isArray(meetingTypes)
    ? meetingTypes.find(({ id }) => id === selectedId)
    : undefined
  const Heading = allowCreation ? 'h3' : 'h2'
  const spacing = allowCreation ? 'mt-3' : 'mt-6'
  const list = meetingTypes === 'loading' ? (
    <p className={`${spacing} text-muted-foreground`} role="status">Загружаем типы встреч…</p>
  ) : meetingTypes === 'error' ? (
    <p className={spacing} role="alert">Не удалось загрузить типы встреч.</p>
  ) : meetingTypes.length === 0 ? (
    <p className={`${spacing} text-muted-foreground`}>Типов встреч пока нет.</p>
  ) : (
    <ul className={`${spacing} grid gap-3`}>
      {meetingTypes.map((meetingType) => (
        <li key={meetingType.id} className="rounded-lg border p-4">
          <Heading className="font-semibold">
            {allowCreation ? meetingType.name : (
              <button
                type="button"
                aria-pressed={selectedId === meetingType.id}
                disabled={submitting}
                onClick={() => setSelectedId(meetingType.id)}
                className="min-h-11 cursor-pointer rounded-sm text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                {meetingType.name}
              </button>
            )}
          </Heading>
          <p className="mt-1 text-sm text-muted-foreground">{meetingType.description}</p>
          <p className="mt-2 text-sm">{meetingType.durationMinutes} мин</p>
        </li>
      ))}
    </ul>
  )

  if (allowCreation) {
    return (
      <>
        <section aria-labelledby="owner-meeting-types" className="rounded-xl border bg-muted/40 p-4 sm:p-5">
          <h2 id="owner-meeting-types" className="text-xl font-semibold">Типы встреч</h2>
          {list}
        </section>
        <section aria-labelledby="create-meeting-type" className="rounded-xl border bg-muted/40 p-4 sm:p-5">
          <h2 id="create-meeting-type" className="text-xl font-semibold">Новый тип встречи</h2>
          {Array.isArray(meetingTypes) && (
            <CreateMeetingTypeForm onCreated={(created) => {
              setMeetingTypes((current) => Array.isArray(current) ? [...current, created] : [created])
            }} />
          )}
        </section>
      </>
    )
  }

  return (
    <>
      {list}
      {selectedType && (
        <BookingAvailability
          key={selectedType.id}
          meetingType={selectedType}
          submitting={submitting}
          setSubmitting={setSubmitting}
        />
      )}
    </>
  )
}

export default MeetingTypeList
