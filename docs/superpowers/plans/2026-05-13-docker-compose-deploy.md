# Docker Compose Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docker-based production deployment path for this project on a single Vultr host, triggered by GitHub Actions on pushes to `main`.

**Architecture:** Build two containers with Docker Compose: a FastAPI backend container and an nginx-served frontend container produced from the Vite build output. Expose only the frontend container on host port `18080`, keep the backend private on the Compose network, and let a host-level nginx proxy route public traffic into the frontend container.

**Tech Stack:** Docker, Docker Compose, nginx, FastAPI, React, Vite, GitHub Actions

---

### Task 1: Add container build files

**Files:**
- Create: `Dockerfile.backend`
- Create: `Dockerfile.frontend`
- Create: `deploy/nginx.conf`

- [ ] **Step 1: Add the backend Dockerfile**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app

EXPOSE 8000

CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Add the frontend Dockerfile**

```dockerfile
FROM node:20-alpine AS build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
```

- [ ] **Step 3: Add frontend nginx runtime config**

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### Task 2: Add Compose orchestration

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Add the production compose file**

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    env_file:
      - .env
    expose:
      - "8000"
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    depends_on:
      - backend
    ports:
      - "18080:80"
    restart: unless-stopped
```

### Task 3: Add GitHub Actions deployment workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add the deployment workflow**

```yaml
name: Deploy to Vultr

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.VULTR_HOST }}
          username: ${{ secrets.VULTR_USER }}
          key: ${{ secrets.VULTR_SSH_KEY }}
          port: ${{ secrets.VULTR_PORT || 22 }}
          script: |
            set -e
            cd /projects/AI-Project-Manager-Assistant
            git pull --ff-only origin main
            docker compose up -d --build --remove-orphans
```

### Task 4: Document server setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add deployment instructions covering**

```text
- Docker and Docker Compose installation on the server
- Repository path /projects/AI-Project-Manager-Assistant
- Server-local .env creation
- Host nginx proxying to 127.0.0.1:18080
- Required GitHub Actions secrets
```
