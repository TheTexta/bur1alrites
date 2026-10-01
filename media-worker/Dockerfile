FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY worker.mjs r2.mjs ./

CMD ["node", "worker.mjs"]
