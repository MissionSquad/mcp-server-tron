FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN groupmod -n ec2-user node && \
    usermod -l ec2-user node

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build
COPY docker-start.sh ./docker-start.sh

RUN mkdir -p /app/logs \
  && mkdir -p /app/data \
  && chown -R ec2-user:ec2-user /app \
  && chmod +x /app/docker-start.sh

USER ec2-user

ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3001
ENV MCP_LOG_DIR=/app/logs
ENV MCP_DATA_DIR=/app/data

EXPOSE 3001

ENTRYPOINT ["./docker-start.sh"]
