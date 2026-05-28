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

FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=engine-build /usr/local/bin/fairy-stockfish /usr/local/bin/fairy-stockfish
COPY ChessBorder/ChessBorder/Resources/Engine/variants.ini /app/variants.ini
COPY server/requirements.txt /app/requirements.txt
COPY server/engine.py /app/engine.py
COPY server/main.py /app/main.py

WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt

ENV ENGINE_BIN=/usr/local/bin/fairy-stockfish
ENV VARIANTS_INI=/app/variants.ini
EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
