FROM python:3.12-slim-bookworm AS engine-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential clang && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/fairy-stockfish/Fairy-Stockfish.git /src
WORKDIR /src/src
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) ARCH=x86-64-avx2 ;; \
      arm64) ARCH=armv8 ;; \
      *) ARCH=general-64 ;; \
    esac && \
    make -j"$(nproc)" build ARCH=$ARCH COMP=gcc largeboards=yes && \
    cp stockfish /usr/local/bin/fairy-stockfish

FROM node:22-bookworm-slim AS validator-build

WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/tsconfig.json ./
COPY web/scripts/validate-move-cli.ts ./scripts/
COPY web/src ./src
RUN npx esbuild scripts/validate-move-cli.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --outfile=validate-move.js

FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY --from=engine-build /usr/local/bin/fairy-stockfish /usr/local/bin/fairy-stockfish
COPY --from=validator-build /build/validate-move.js /app/validate-move.js
COPY ChessBorder/ChessBorder/Resources/Engine/variants.ini /app/variants.ini
COPY server/requirements.txt /app/requirements.txt
COPY server/engine.py /app/engine.py
COPY server/engine_manager.py /app/engine_manager.py
COPY server/validation.py /app/validation.py
COPY server/client_move_check.py /app/client_move_check.py
COPY server/fen_transform.py /app/fen_transform.py
COPY shared/engine-column-map.json /app/shared/engine-column-map.json
COPY server/main.py /app/main.py

WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --shell /usr/sbin/nologin engine
USER engine

ENV ENGINE_BIN=/usr/local/bin/fairy-stockfish
ENV VARIANTS_INI=/app/variants.ini
ENV CLIENT_PARITY_CHECK=1
EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
