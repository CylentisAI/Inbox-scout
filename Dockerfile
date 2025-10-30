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
RUN pnpm install --frozen-lockfile

# Build the application
RUN pnpm build

# Copy startup script
COPY start.js ./start.js

# Expose port (Railway will override with PORT env var)
EXPOSE 3000

# Start with the wrapper script for better error visibility
CMD ["node", "start.js"]
