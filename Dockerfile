FROM node:24.22.3-bookworm-slim AS build
WORKDIR /app
COPY call-calendar/package.json call-calendar/package-lock.json ./
RUN --mount=type=cache,id=call-calendar-npm,target=/root/.npm npm ci
COPY call-calendar/index.html call-calendar/tsconfig*.json call-calendar/vite.config.ts ./
COPY call-calendar/public ./public
COPY call-calendar/server ./server
COPY call-calendar/src ./src
RUN npm run build && npm exec -- vite build --ssr server/start.ts --outDir dist-ssr

FROM node:24.22.3-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-ssr ./dist-ssr
USER node
EXPOSE 8080
CMD ["node", "dist-ssr/start.js"]
