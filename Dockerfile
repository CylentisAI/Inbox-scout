# Use Node.js 18 LTS
FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all workspace packages
COPY packages/ ./packages/
COPY services/ ./services/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the application
RUN pnpm build

# Copy startup script
COPY start.js ./start.js

# Expose port (Railway will override with PORT env var)
EXPOSE 3000

# Start with the wrapper script for better error visibility
CMD ["node", "start.js"]
