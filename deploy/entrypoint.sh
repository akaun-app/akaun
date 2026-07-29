#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Ensure a group with the requested GID exists
if ! getent group "${PGID}" > /dev/null 2>&1; then
  addgroup -g "${PGID}" appgroup
fi
GROUPNAME=$(getent group "${PGID}" | cut -d: -f1)

# Ensure a user with the requested UID exists
if ! getent passwd "${PUID}" > /dev/null 2>&1; then
  adduser -u "${PUID}" -G "${GROUPNAME}" -s /bin/sh -D appuser
fi
USERNAME=$(getent passwd "${PUID}" | cut -d: -f1)

# Fix ownership of the data dir only (app files are world-readable, no write needed)
chown -R "${PUID}:${PGID}" /app/data

exec su-exec "${USERNAME}" "$@"
