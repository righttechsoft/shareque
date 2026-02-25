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

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
