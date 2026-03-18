FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN groupadd --system ec2-user && useradd --system --gid ec2-user --create-home ec2-user

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build
COPY docker-start.sh ./docker-start.sh

RUN mkdir -p /app/logs \
  && chown -R ec2-user:ec2-user /app \
  && chmod +x /app/docker-start.sh

USER ec2-user

ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3001
ENV MCP_LOG_DIR=/app/logs

EXPOSE 3001

ENTRYPOINT ["./docker-start.sh"]
