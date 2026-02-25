#!/bin/sh
chown -R appuser:appgroup /app/data 2>/dev/null || true
exec runuser -u appuser -- bun run src/index.tsx
