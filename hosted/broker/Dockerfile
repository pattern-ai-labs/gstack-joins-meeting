FROM python:3.12-slim

# This Dockerfile is built with the REPO ROOT as the build context, not
# hosted/broker/. That lets the broker layer pull data/specialists.json
# from the repo without duplicating the file. Build:
#
#   (from repo root)  docker build -f hosted/broker/Dockerfile .

WORKDIR /app

# Deps first for layer caching
COPY hosted/broker/requirements.txt /app/broker/requirements.txt
RUN pip install --no-cache-dir -r /app/broker/requirements.txt

# Code + canonical specialist data
COPY hosted/broker/ /app/broker/
COPY data/          /app/data/

ENV PYTHONUNBUFFERED=1 \
    GSTACK_BROKER_PORT=8787

EXPOSE 8787

CMD ["python3", "-m", "broker.main", "--host", "0.0.0.0", "--port", "8787"]
