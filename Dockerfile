# Use Node.js 18 LTS
FROM node:18-alpine

# Install pnpm and build dependencies
RUN npm install -g pnpm@8.15.0 && \
    apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy workspace packages and services
COPY packages/ ./packages/
COPY services/ ./services/

# Install all dependencies (including dev dependencies needed for build)
# Note: Using --no-frozen-lockfile temporarily to allow lockfile update for express dependency
RUN pnpm install --no-frozen-lockfile

# Build the application
RUN pnpm build

# Copy startup script
COPY start.js ./start.js

# Copy LinkedIn export ZIP file for automatic ingestion
# NOTE: This is only needed for first-time ingestion. After data is in Pinecone,
# the service will skip ingestion automatically. You can remove this line and
# the ZIP file from the repo after first successful deployment to reduce image size.
COPY linkedin-export.zip ./linkedin-export.zip

# Expose port (Railway will override with PORT env var)
EXPOSE 3000

# Start with the wrapper script for better error visibility
CMD ["node", "start.js"]
