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
RUN rm -f src/routes/playlists.ts
RUN npm install
RUN npx prisma generate
RUN npm run build

# Install dependencies and build for Worker
WORKDIR /app/apps/worker-stream
RUN rm -f src/check-playlist.ts
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
# Force environment variables for internal routing\n\
export DATABASE_URL="file:/storage/live-get.db"\n\
export PORT_BACKEND=5000\n\
export PORT_WORKER=5001\n\
\n\
# Create storage directory if it does not exist\n\
mkdir -p /storage\n\
\n\
# Run Prisma Push to create tables instantly from schema\n\
cd /app/apps/backend && npx prisma db push --accept-data-loss\n\
cd /app/apps/worker-stream && npx prisma db push --accept-data-loss\n\
\n\
# Start backend in background\n\
cd /app/apps/backend && PORT=$PORT_BACKEND npm run start &\n\
\n\
# Start worker in background\n\
cd /app/apps/worker-stream && PORT=$PORT_WORKER npm run start &\n\
\n\
# Start frontend in foreground on port 80 (EasyPanel default)\n\
cd /app/apps/frontend && PORT=80 npm run start\n\
' > /app/start.sh

RUN chmod +x /app/start.sh

# The public port for the Frontend (EasyPanel Default)
EXPOSE 80

ENV NODE_ENV=production

# The startup script runs everything
CMD ["/app/start.sh"]
