FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY worker.mjs ./worker.mjs

CMD ["node", "worker.mjs"]
