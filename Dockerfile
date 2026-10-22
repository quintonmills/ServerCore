FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/output && chown node:node /app/output

USER node
EXPOSE 5000

CMD ["npm", "start"]
