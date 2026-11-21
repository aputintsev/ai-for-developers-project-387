import { randomUUID } from 'node:crypto'
import type { CreateMeetingTypeInput } from '../src/api/generated/models/createMeetingTypeInput.ts'
import type { MeetingType } from '../src/api/generated/models/meetingType.ts'

export function createMeetingTypeStore(initialMeetingTypes: readonly MeetingType[] = []) {
  const meetingTypes = [...initialMeetingTypes]

  return {
    list: () => meetingTypes.slice(),
    get: (id: string) => meetingTypes.find((meetingType) => meetingType.id === id),
    create(input: CreateMeetingTypeInput) {
      const name = input.name.trim()
      const existingType = meetingTypes.find((meetingType) => meetingType.name.trim().toLowerCase() === name.toLowerCase())
      if (existingType) return undefined

      const meetingType = { ...input, id: randomUUID(), name }
      meetingTypes.push(meetingType)
      return meetingType
    },
  }
}
