# syntax=docker/dockerfile:1.7

# Two images from one file. `development` carries the test and lint tooling the
# quality gates run through Compose; `production` carries the application and
# nothing else, so a shell on a live container cannot reach pytest, mypy or
# ruff. Both run as the same unprivileged `dixora` user.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    RUFF_CACHE_DIR=/tmp/dixora-ruff-cache \
    MYPY_CACHE_DIR=/tmp/dixora-mypy-cache \
    PYTEST_ADDOPTS="-o cache_dir=/tmp/dixora-pytest-cache"

WORKDIR /app

# DejaVu covers the Turkish alphabet (ı, İ, ş, ğ, ö, ü, ç). Pillow's bundled
# face does not, so membership cards render those as empty boxes without it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system dixora \
    && adduser --system --ingroup dixora dixora

COPY apps/api/requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

FROM base AS development

COPY apps/api/requirements-dev.txt ./
RUN python -m pip install --no-cache-dir -r requirements-dev.txt

COPY --chown=dixora:dixora apps/api ./
RUN python -m pip install --no-cache-dir --no-deps .

USER dixora
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS production

COPY --chown=dixora:dixora apps/api ./
RUN python -m pip install --no-cache-dir --no-deps .

USER dixora
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

# Behind a reverse proxy the deployment overrides this to add --proxy-headers
# and the trusted network; see docker-compose.prod.yml.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
