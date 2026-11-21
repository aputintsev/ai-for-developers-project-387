import { readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { createCalendarApi } from './api.ts'

const dist = resolve(import.meta.dirname, '../dist')
const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

function sendStatus(response: ServerResponse, status: number) {
  response.writeHead(status).end()
}

async function serveFile(response: ServerResponse, pathname: string) {
  const filename = resolve(dist, `.${pathname}`)
  if (!filename.startsWith(dist + sep)) {
    sendStatus(response, 404)
    return
  }

  try {
    const body = await readFile(filename)
    const contentType = contentTypes[extname(filename)] ?? 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' })
    response.end(body)
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code
    sendStatus(response, missing === 'ENOENT' || missing === 'ENOTDIR' || missing === 'EISDIR' ? 404 : 500)
  }
}

const handleCalendarApi = createCalendarApi()
const server = createServer((request, response) => {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    sendStatus(response, 400)
    return
  }

  if (handleCalendarApi(request, response)) return
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    sendStatus(response, 404)
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  void serveFile(response, extname(pathname) ? pathname : '/index.html')
})

const port = Number(process.env.PORT ?? 8080)
server.listen(port, '0.0.0.0')
