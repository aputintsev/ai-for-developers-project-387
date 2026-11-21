import { randomUUID } from 'node:crypto'
import type { Booking } from '../src/api/generated/models/booking.ts'
import type { Slot } from '../src/api/generated/models/slot.ts'

export function createBookingStore() {
  const bookings: { booking: Booking; guestProfileKey: string }[] = []

  function isFree(slot: Slot) {
    // Working slots and stored bookings use canonical UTC timestamps.
    return !bookings.some(({ booking }) => booking.start < slot.end && slot.start < booking.end)
  }

  return {
    isFree,
    listUpcoming(now: Date, profileKey?: string) {
      const after = now.toISOString()
      return bookings
        .filter(({ booking, guestProfileKey }) => booking.start > after
          && (profileKey === undefined || guestProfileKey === profileKey))
        .map(({ booking }) => booking)
        .sort((first, second) => first.start.localeCompare(second.start))
    },
    create(input: Omit<Booking, 'id'>, guestProfileKey: string) {
      if (!isFree(input)) return undefined

      const booking = { ...input, id: randomUUID() }
      bookings.push({ booking, guestProfileKey })
      return booking
    },
  }
}
