FROM oven/bun:1-slim

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY public/ ./public/
COPY src/ ./src/
COPY tsconfig.json ./

RUN mkdir -p data/uploads

EXPOSE 3000

CMD ["bun", "run", "src/index.tsx"]
