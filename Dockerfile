# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/ ./backend/

# Install ALL dependencies (including dev for TypeScript)
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM python:3.11-slim

WORKDIR /app

# Install FastAPI and dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy backend source
COPY backend/ ./backend/

# Expose port (Railway/Render inject the real port via $PORT)
EXPOSE 8080

# Run FastAPI — bind to $PORT when the platform provides it, else 8080
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
