# Postgres + Node, for WAL archiving (WS-B1 layer 2).
#
# NOT BUILT BY A NORMAL DEPLOY. Referenced only from docker-compose.wal.yml, the
# opt-in overlay — see that file for the enable procedure and for why the build
# is kept out of the base compose file.
#
# WHY THIS IMAGE EXISTS
#
#   `archive_command` is executed BY THE POSTGRES PROCESS, inside the Postgres
#   container. The archiver reuses `backup-storage.service` so WAL lands beside
#   the nightly dumps — same driver, same offsite account (D6), same key
#   discipline, and one inverse (`wal-restore.js`) for recovery. That means the
#   Postgres container needs a Node runtime, and the official image has none.
#
# THE ALTERNATIVE THAT WAS REJECTED
#
#   `archive_command` could simply `cp` each segment to a mounted spool
#   directory, with a separate uploader shipping it offsite afterwards. No Node
#   in this image, and it is what pgBackRest's async archiving effectively does.
#
#   It was rejected because it changes what "archived" MEANS. Postgres would
#   consider a segment safe the moment it was copied to the same host whose loss
#   is threat 3 in §3.2 — and if that host dies, every segment still sitting in
#   the spool is gone. The archive would report healthy while its most recent
#   and most valuable segments were the ones at risk. Here, archive_command only
#   succeeds once the segment is genuinely offsite.
#
#   The cost is a slower archive_command (a network round trip per segment) and
#   this image. Both are worth it; if the WAL rate ever outgrows a serial
#   upload, `walStatus`'s lag figure is the signal, and swapping in pgBackRest
#   keeps the same bucket layout.
#
# Node 20 from nodesource — the base is Debian bookworm, whose packaged Node is
# too old for the `fetch` and `AbortSignal.timeout` the storage service uses.

ARG POSTGRES_IMAGE=pgvector/pgvector:pg16
FROM ${POSTGRES_IMAGE}

USER root

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends nodejs; \
    apt-get purge -y --auto-remove gnupg; \
    rm -rf /var/lib/apt/lists/*; \
    node --version

# Back to the image's own user: Postgres refuses to start as root, and
# archive_command inherits this user.
USER postgres
