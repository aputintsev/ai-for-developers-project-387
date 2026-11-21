import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { Connect, Plugin } from "vite"
import type { MeetingType } from "./src/api/generated/models/meetingType.ts"
import { createCalendarApi } from "./server/api.ts"

function calendarApi(initialMeetingTypes?: readonly MeetingType[], now?: () => Date): Plugin {
  function mount(server: { middlewares: Connect.Server }) {
    const handleRequest = createCalendarApi(initialMeetingTypes, now)
    server.middlewares.use((request, response, next) => {
      if (!handleRequest(request, response)) next()
    })
  }

  return {
    name: "calendar-api",
    configureServer: mount,
    configurePreviewServer: mount,
  }
}

// https://vite.dev/config/
export function createCalendarConfig(initialMeetingTypes?: readonly MeetingType[], now?: () => Date) {
  return defineConfig({
    plugins: [react(), tailwindcss(), calendarApi(initialMeetingTypes, now)],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  })
}

export default createCalendarConfig()
