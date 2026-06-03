FROM python:3.12-slim

WORKDIR /app

# Bring just the broker — workers don't need the rest of the repo.
COPY broker/requirements.txt /app/broker/requirements.txt
RUN pip install --no-cache-dir -r /app/broker/requirements.txt

COPY broker/ /app/broker/
COPY data/   /app/data/

ENV PYTHONUNBUFFERED=1 \
    GSTACK_BROKER_PORT=8787

EXPOSE 8787

CMD ["python3", "-m", "broker.main", "--host", "0.0.0.0", "--port", "8787"]
