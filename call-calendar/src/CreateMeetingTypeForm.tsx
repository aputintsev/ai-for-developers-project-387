import { useState } from 'react'
import type { FormEvent } from 'react'
import { createMeetingType } from './api/generated/sdk.gen'
import type { CreateMeetingType400, MeetingType } from './api/generated/models'
import { Button } from './components/ui/button'

const fields = [
  { name: 'name', label: 'Название' },
  { name: 'description', label: 'Описание' },
  { name: 'durationMinutes', label: 'Длительность, мин' },
] as const

const fieldClass = 'w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive'

function CreateMeetingTypeForm({ onCreated }: { onCreated: (meetingType: MeetingType) => void }) {
  const [error, setError] = useState<CreateMeetingType400>()
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const form = event.currentTarget
    const values = new FormData(form)
    setError(undefined)
    setSubmitting(true)

    try {
      const result = await createMeetingType({
        name: String(values.get('name') ?? ''),
        description: String(values.get('description') ?? ''),
        durationMinutes: Number(values.get('durationMinutes')),
      })

      if (result.status === 201) {
        onCreated(result.data)
        form.reset()
      } else if (result.status === 400 || result.status === 409) {
        setError(result.data)
      } else {
        setError({ message: 'Не удалось создать тип встречи.', fieldErrors: {} })
      }
    } catch {
      setError({ message: 'Не удалось создать тип встречи.', fieldErrors: {} })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form aria-labelledby="create-meeting-type" className="mt-4" onSubmit={submit} noValidate>
      <fieldset className="grid gap-4" disabled={submitting}>
        {fields.map(({ name, label }) => {
          const fieldError = error?.fieldErrors[name]
          const fieldId = `meeting-type-${name}`
          const errorId = `${fieldId}-error`
          const props = {
            id: fieldId,
            name,
            className: fieldClass,
            required: true,
            'aria-invalid': Boolean(fieldError),
            'aria-describedby': fieldError ? errorId : undefined,
          }

          return (
            <div key={name} className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor={fieldId}>{label}</label>
              {name === 'description' ? (
                <textarea {...props} rows={3} />
              ) : name === 'durationMinutes' ? (
                <input {...props} type="number" min={1} max={480} step={1} />
              ) : (
                <input {...props} type="text" />
              )}
              {fieldError && <p id={errorId} className="text-sm text-destructive">{fieldError}</p>}
            </div>
          )
        })}
        {error && <p className="text-sm text-destructive" role="alert">{error.message}</p>}
        <Button type="submit" className="min-h-11 justify-self-start">
          {submitting ? 'Создаём…' : 'Создать тип встречи'}
        </Button>
      </fieldset>
    </form>
  )
}

export default CreateMeetingTypeForm
