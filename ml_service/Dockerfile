# ZapShield — ML Microservice Dockerfile
# ─────────────────────────────────────────────
# Build context: ml_service/
# Place this at: ml_service/Dockerfile

FROM python:3.11-bookworm

WORKDIR /app

# Install dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Train models at build time so the container starts instantly.
# In production, models are retrained weekly via a cron job that
# mounts the models/ volume and re-executes train_*.py scripts.
RUN python train_zone_risk.py && python train_fraud_model.py

EXPOSE 5001

# Healthcheck — matches docker-compose expectation
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5001/health')"

CMD ["python", "app.py"]
