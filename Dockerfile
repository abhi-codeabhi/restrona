# Cloud-agnostic single image for the Restorna platform.
# The platform is dependency-free (no npm install needed), so this is a simple
# copy of the repo onto a small Node base. The APP env var selects which app the
# container runs; the same image serves customer/waiter/kitchen/billing/ordering.
FROM node:20-alpine AS base
WORKDIR /app

# Copy the whole repo. .dockerignore trims the cruft.
COPY . .

# Install runtime deps (only `pg`, used when DATABASE_URL is set). The app is
# otherwise dependency-free, so this is tiny. Then drop to the unprivileged
# "node" user (uid 1000) that node:20-alpine ships.
RUN npm install --omit=dev --no-audit --no-fund && chown -R node:node /app
USER node

# Defaults; override APP per service at deploy time.
ENV APP=customer \
    PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

# Liveness check against the app's /healthz endpoint using Node (no curl in the
# base image). Exits non-zero if the endpoint is not 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "bin/serve.js"]
