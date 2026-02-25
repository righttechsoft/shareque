FROM oven/bun:1-slim

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY public/ ./public/
COPY src/ ./src/
COPY tsconfig.json ./

RUN mkdir -p data/uploads

RUN groupadd --system appgroup && useradd --system --gid appgroup --no-create-home appuser
RUN chown -R appuser:appgroup data

USER appuser

EXPOSE 3000

CMD ["bun", "run", "src/index.tsx"]
