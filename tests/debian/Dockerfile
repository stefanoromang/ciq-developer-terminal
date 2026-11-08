ARG DEBIAN_VERSION=12
FROM node:24-bookworm-slim AS node
FROM debian:${DEBIAN_VERSION}-slim
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git xvfb xauth dbus-x11 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    libgbm1 libasound2-dev libxss1 libdrm2 libxshmfence1 libx11-xcb1 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 ciq
WORKDIR /work
COPY --chown=ciq:ciq . .
RUN chown ciq:ciq /work
USER ciq
RUN npm ci && npm run build
CMD ["bash", "tests/debian/run.sh"]
