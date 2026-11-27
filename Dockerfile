# HobbyLM Guide: page + /api/search in one container, for a free Hugging Face CPU Space.
# Not yet test-built (no Docker on the dev machine). Build: docker build -t hobbylm-guide .

# ---- 1. build the static site ----
FROM node:22-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/ src/
COPY public/ public/
COPY data/ data/
# Where private mode downloads the fp32 ONNX from (a public fuellabs model repo, once approved).
ARG VITE_PRIVATE_MODEL_URL=""
ENV VITE_PRIVATE_MODEL_URL=$VITE_PRIVATE_MODEL_URL
RUN npm run build

# ---- 2. search server ----
FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.0 \
 && pip install --no-cache-dir -r server/requirements.txt
ENV HF_HOME=/app/hf
# Bake the pinned model into the image so the server never downloads at runtime.
RUN python -c "from sentence_transformers import SentenceTransformer as S; S('harims95/hobbylm-embed-140m', revision='ea708cee107818fa0c1871eebd26d82a1e3fb1aa', trust_remote_code=True, device='cpu')" \
 && chown -R user /app/hf
COPY server/*.py server/
COPY data/services.json data/hinglish_map.json data/tanglish_map.json data/kanglish_map.json data/emergency.json data/search_config.json data/flows.json data/
COPY data/index/ data/index/
COPY data/sources/passages.json data/sources/passages.json
COPY --from=web /web/dist/ dist/
USER user
ENV HF_HUB_OFFLINE=1 \
    PYTHONPATH=/app/server \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=7860 \
    STATIC_DIR=/app/dist \
    TRUST_PROXY=1 \
    FEEDBACK_FILE=/tmp/feedback_counts.json
EXPOSE 7860
CMD ["python", "server/search_server.py"]
