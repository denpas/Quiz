FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p /app/data /app/resultats && chown -R node:node /app
USER node

EXPOSE 3050
CMD ["node", "src/server.js"]
