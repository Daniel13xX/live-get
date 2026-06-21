FROM node:20-slim

# Install system dependencies including ffmpeg, python3, etc.
RUN apt-get update && \
    apt-get install -y ffmpeg curl python3 python3-pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install dependencies and build for Backend
WORKDIR /app/apps/backend
RUN npm install
RUN npx prisma generate
RUN npm run build

# Install dependencies and build for Worker
WORKDIR /app/apps/worker-stream
RUN npm install
RUN npx prisma generate
RUN npm run build

# Install dependencies and build for Frontend
WORKDIR /app/apps/frontend
RUN npm install
RUN npm run build

WORKDIR /app

# Create a startup script to run all three services concurrently
RUN echo '#!/bin/bash\n\
# Run Prisma Migrations before starting\n\
cd /app/apps/backend && npx prisma migrate deploy\n\
\n\
# Start backend in background\n\
cd /app/apps/backend && npm run start &\n\
\n\
# Start worker in background\n\
cd /app/apps/worker-stream && npm run start &\n\
\n\
# Start frontend in foreground\n\
cd /app/apps/frontend && npm run start\n\
' > /app/start.sh

RUN chmod +x /app/start.sh

# The public port for the Frontend
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# The startup script runs everything
CMD ["/app/start.sh"]
