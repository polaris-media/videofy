FROM node:22-bookworm

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY package.json package-lock.json ./
COPY cms/package.json ./cms/package.json
COPY player/package.json ./player/package.json
COPY types/package.json ./types/package.json

RUN npm install

COPY . .

RUN npm run build -w @videofy/cms

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@videofy/cms", "--", "--hostname", "0.0.0.0", "--port", "3000"]
