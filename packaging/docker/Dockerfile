# ===== frontend build =====
FROM node:24 AS frontend-builder

WORKDIR /app/frontend

# enable caching dependencies in separate layer
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

# ===== backend build =====
FROM astral/uv:trixie AS backend-builder

ENV UV_NO_DEV=1
ENV UV_NO_EDITABLE=1
ENV UV_LINK_MODE=copy
ENV UV_MANAGED_PYTHON=1
ENV UV_VENV_RELOCATABLE=1
ENV UV_PYTHON_INSTALL_DIR=/opt

WORKDIR /app/backend

RUN apt-get update && apt-get install -y libpq5 && rm -rf /var/lib/apt/lists/*

# enable caching dependencies in separate layer
COPY backend/uv.lock backend/pyproject.toml backend/.python-version ./
COPY proto /app/proto
COPY .python-version /app/.python-version
RUN uv sync --frozen --no-install-project

COPY backend ./
RUN uv sync --locked

# ===== runtime =====
FROM debian:trixie-slim

RUN groupadd -r transcribee && useradd -r -u 1001 -g transcribee transcribee

WORKDIR /app/backend

RUN apt-get update && apt-get install -y libpq5 file && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /opt /opt
COPY --from=backend-builder /app/backend ./
COPY --from=frontend-builder /app/frontend/dist ./public

COPY packaging/docker/run.sh /run.sh

ENV STORAGE_PATH=/var/transcribee/storage
RUN mkdir -p "$STORAGE_PATH" && chown transcribee:transcribee "$STORAGE_PATH"

ENV PATH="/app/backend/.venv/bin:$PATH"

USER transcribee
CMD [ "/run.sh" ]
