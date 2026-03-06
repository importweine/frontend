#!/bin/sh
set -e

echo "=== MediCard Startup ==="
echo "PORT=$PORT"
echo "NODE_ENV=$NODE_ENV"
echo "DATABASE_URL is set: $([ -n "$DATABASE_URL" ] && echo 'yes' || echo 'NO!')"

echo "Running prisma db push..."
npx prisma db push --skip-generate
echo "Database schema synced."

echo "Starting Node.js server..."
exec node dist/index.js
