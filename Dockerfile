FROM node:20-alpine AS base
# chromium + shared libs/fonts: PDF rendering (invoices, reports, payslips) goes
# through src/services/pdf.service.js (Puppeteer) from both the API process
# (runtime) and the BullMQ worker (report-processor.js), so both stages need a
# working headless Chromium. Alpine's puppeteer-bundled Chromium download is
# glibc-only and fails to launch on musl, so we install the distro package
# instead and point Puppeteer at it (PUPPETEER_EXECUTABLE_PATH below) while
# skipping its own download during `npm ci`. ttf-freefont gives PDF output
# (e.g. the ₦ Naira sign in pdf.templates.js) broad glyph coverage.
RUN apk add --no-cache \
      ffmpeg postgresql-client tini \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont
# Alpine's chromium package installs the binary at /usr/bin/chromium (the legacy
# /usr/bin/chromium-browser name no longer exists on current Alpine). pdf.service
# also auto-detects the real path, so a mismatch here no longer breaks rendering.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
# packages/ MUST be copied before install. package.json declares
#   "@praxis/shared": "file:packages/shared"
# and a file: dependency is resolved at install time — without the directory
# present, npm cannot link it.
#
# 2026-08-04: this was missing, and the failure mode was quiet. The layer was
# cached from before @praxis/shared was added, so builds kept succeeding while
# producing an image whose node_modules had no @praxis/shared. The only importer
# is finance/final_invoice/final_invoice.validator.js, so `require()` of that
# module threw and the module-loader skipped it — meaning the INVOICING MODULE
# was absent from the running API and every one of its routes 404'd,
# indistinguishable from a wrong URL (audit API F-19).
#
# It was also a time bomb: the next change to package.json invalidates the cache,
# npm install hits the missing path, and the build fails outright.
#
# Caught by `npm test` (ai-readiness + ai-writes), which is the argument for
# running the suite rather than reasoning about it.
COPY packages/ ./packages/
# `npm install`, NOT `npm ci`: the lockfile is Windows-generated, so `ci` would
# omit the Linux/musl platform binaries (sharp, argon2, …) and the app would
# crash at require-time. install re-resolves platform-specific optional deps.
RUN npm install --omit=dev --no-audit --no-fund

# ---- SPA build ------------------------------------------------------------
# server.js serves client/dist as the single-origin PWA when it exists — the
# deployed container must ship it or users get a bare API. The client declares
# "praxis-ls": "file:.." so the whole repo is the build context here. Same
# Windows-lockfile caveat → npm install (vite/rollup need linux-musl binaries).
FROM base AS clientbuild
COPY . .
RUN npm install --prefix client --no-audit --no-fund \
 && npm run build --prefix client

# ---- Platform console build ----------------------------------------------
# The Praxis-side admin console (platform-console/) is its own Vite app; server.js
# serves its dist ONLY on the admin host (PLATFORM_CONSOLE_HOST). Same Windows-
# lockfile caveat → npm install (vite/rollup need linux-musl binaries).
FROM base AS consolebuild
COPY platform-console/ ./platform-console/
RUN npm install --prefix platform-console --no-audit --no-fund \
 && npm run build --prefix platform-console

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=clientbuild /app/client/dist ./client/dist
COPY --from=consolebuild /app/platform-console/dist ./platform-console/dist
ENV NODE_ENV=production
# Build identity (audit TEST-R2 / OBS-I5). A running container could not say
# which commit it was, so "is the fix deployed?" and "which image do I roll back
# to?" were both unanswerable from the running system. Surfaced on
# /api/health and /api/health/ready; passed in by scripts/deploy.sh.
ARG BUILD_SHA=""
ARG BUILD_TIME=""
ENV BUILD_SHA=$BUILD_SHA \
    BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.revision=$BUILD_SHA \
      org.opencontainers.image.created=$BUILD_TIME
EXPOSE 8080
# SEC-L1 — do not run the application as root.
#
# Both stages ran as root, and compose bind-mounts ./data (the document vault),
# ./media, ./uploads and ./logs into them. A single RCE-class bug in a
# root-owned process therefore reached the host filesystem with full rights over
# every file it could see, and the vault holds contracts, payslips and ID
# documents. Dropping to an unprivileged user does not fix such a bug; it caps
# what one costs.
#
# `node` (uid 1000) already exists in node:*-alpine, so there is no user to
# create. /app is chowned so anything the image itself writes stays writable.
#
# THE BIND MOUNTS ARE THE OPERATIONAL HALF, and this is the part that breaks a
# deployment if it is skipped: a host directory owned by root stays root-owned
# inside the container, so the app would start and then fail its first write —
# a rendered PDF, a log line — at runtime rather than at boot. scripts/deploy.sh
# now chowns those four paths to 1000:1000 before bringing containers up. An
# existing deployment's files are root-owned today, so that first run does the
# one-off repair.
RUN chown -R node:node /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]

FROM base AS worker
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV ENABLE_WORKERS=true
# SEC-L1 — same treatment as `runtime`; the worker mounts the same ./data.
RUN chown -R node:node /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/jobs/workers.js"]
