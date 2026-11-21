import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { TLSSocket } from 'node:tls'

const cookieName = 'calendarGuest'
const profileKeyPattern = /^[0-9a-f]{64}$/
const oneYearSeconds = 365 * 24 * 60 * 60

export function guestProfileKey(request: IncomingMessage) {
  const cookies = request.headers.cookie?.split(';') ?? []
  for (const cookie of cookies) {
    const [name, value, extra] = cookie.trim().split('=')
    if (name === cookieName && extra === undefined && value && profileKeyPattern.test(value)) {
      return value
    }
  }
  return undefined
}

export function newGuestProfileKey() {
  return randomBytes(32).toString('hex')
}

export function guestProfileCookie(request: IncomingMessage, key: string) {
  const secure = request.socket instanceof TLSSocket && request.socket.encrypted ? '; Secure' : ''
  return `${cookieName}=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${oneYearSeconds}${secure}`
}
