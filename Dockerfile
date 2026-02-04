# --- Stage 1: Builder ---
FROM node:25-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install all dependencies (including devDependencies for build scripts)
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the project (e.g., compile TypeScript to JS)
# Skip this line if you are running pure JavaScript
RUN npm run build

# --- Stage 2: Runner ---
FROM node:25-alpine AS runner

# Set environment to production
ENV NODE_ENV=production

WORKDIR /app

# Copy only the necessary files from the builder stage
# 1. Copy the production-ready build folder (usually 'dist' or 'build')
COPY --from=builder /app/dist ./dist
# 2. Copy package files to install production-only dependencies
COPY --from=builder /app/package*.json ./

# Install ONLY production dependencies (ignores devDependencies)
RUN npm ci --only=production

# Use an unprivileged user for better security
USER node

# Start the application
CMD ["node", "dist/server.js"]