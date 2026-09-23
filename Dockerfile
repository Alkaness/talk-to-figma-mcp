# Use the Bun image as the base image
FROM oven/bun:latest

# Set the working directory in the container
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN bun install

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Listen on all container interfaces (the relay defaults to 127.0.0.1, which
# is unreachable through Docker port publishing). Publish with
# -p 127.0.0.1:3055:3055 to keep it local to the host.
ENV FIGMA_SOCKET_HOST=0.0.0.0

# Expose WebSocket port
EXPOSE 3055

# Run TypeScript directly with Bun
CMD ["bun", "run", "src/socket.ts"]
