# Optional container build. Works on x86 and ARM (Raspberry Pi 4/5).
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
VOLUME ["/app/server/data"]
CMD ["npm", "run", "start"]
