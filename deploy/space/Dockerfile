# HobbyIndia search API: HobbyLM-Embed behind /api/search, for a free Hugging Face CPU Space.
# The website itself is hosted separately (Vercel); this container serves only the API.
FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.0 \
 && pip install --no-cache-dir -r server/requirements.txt
ENV HF_HOME=/app/hf
# Bake the pinned model into the image so the server never downloads it at runtime.
RUN python -c "from sentence_transformers import SentenceTransformer as S; S('harims95/hobbylm-embed-140m', revision='ea708cee107818fa0c1871eebd26d82a1e3fb1aa', trust_remote_code=True, device='cpu')" \
 && chown -R user /app/hf
COPY server/search_core.py server/search_server.py server/passage_search.py server/
COPY data/ data/
USER user
# ALLOW_ORIGIN: comma-separated site origins allowed to call the API (set as a Space variable).
ENV HF_HUB_OFFLINE=1 \
    PYTHONPATH=/app/server \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=7860 \
    TRUST_PROXY=1 \
    FEEDBACK_FILE=/tmp/feedback_counts.json
EXPOSE 7860
CMD ["python", "server/search_server.py"]
