# Harvest Hollow, multi-farm hosted mode (docs/agent-briefs/multi-farm.md; how to deploy: deploy/cloud.md).
#   docker build -t harvest-hollow .
#   docker run -p 3000:3000 -v hh-data:/data harvest-hollow
# One persistent volume at /data holds every farm (farms/<id>/). The game itself runs as the unprivileged `node`
# user; the entrypoint starts as root only to hand a fresh (root-owned) cloud volume to that user, then drops to it.
FROM node:24-slim

ENV NODE_ENV=production \
    HH_MODE=multi \
    HH_DATA_DIR=/data \
    HH_HOST=0.0.0.0 \
    PORT=3000 \
    HH_LOG=json

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown node:node /data

# no VOLUME instruction: Railway refuses it, and every host (and `docker run -v`) mounts its own volume at /data
EXPOSE 3000

# /api/status is the global health check (farm counts, never a farm id); 503-free while every farm saves fine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# SIGTERM (a redeploy, a scale-down): every loaded farm closes its sockets and writes its final snapshot.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/bin/sh", "-c", "\
  if [ \"$(id -u)\" = 0 ]; then \
    mkdir -p \"$HH_DATA_DIR\" && \
    { [ \"$(stat -c %u \"$HH_DATA_DIR\")\" = \"$(id -u node)\" ] || chown -R node:node \"$HH_DATA_DIR\"; } && \
    exec setpriv --reuid=node --regid=node --init-groups node server/index.js; \
  fi; \
  exec node server/index.js"]
