# Markdown-to-PDF v2: EC2 Deployment Guide

This guide covers the full lifecycle of deploying the v2 application to AWS using a single-box architecture.

---

## Tech Stack Overview

| Component | Technology |
|-----------|-----------|
| Server | AWS EC2 `t4g.small` ARM64 (2 GB RAM) |
| Backend | Rust / Axum (`/health`, `POST /share`, `GET /share/{id}`) |
| Share storage | Redis 7 (in-memory, 7-day TTL, zstd-compressed) |
| Frontend | Static HTML/JS (client-side rendering, no Node on EC2) |
| Web server | Caddy |
| Ingress / SSL | Cloudflare Tunnel |
| CI/CD | GitHub Actions (two-job: verify-and-build on runner → deploy to EC2) |

The frontend is built on the GitHub Actions runner and pushed to EC2 as a pre-built artifact. The backend is compiled on EC2 with the 2 GB swap file active.

---

## Phase 1 — Provisioning the EC2 Instance

1. Log in to the **AWS Console** and navigate to **EC2 > Instances > Launch instances**.
2. **Name:** `markdown-to-pdf-prod`
3. **AMI:** Ubuntu Server 24.04 LTS — change architecture to **64-bit (Arm)**.
4. **Instance type:** `t4g.small` (2 GB RAM, 2 vCPU).
5. **Key pair:** Create `md2pdf-key.pem` and download it.
6. **Network settings:** Allow **SSH (port 22)** only. Cloudflare Tunnel handles HTTP/HTTPS without open web ports.
7. **Storage:** 10 GB `gp3`.
8. Click **Launch Instance**.

---

## Phase 2 — Server Preparation

SSH into the instance:
```bash
ssh -i /path/to/md2pdf-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

### 2a. Update packages
```bash
sudo apt update && sudo apt upgrade -y
```

### 2b. Create a 2 GB swap file (required for Rust compilation on t4g.small)

The Rust linker needs roughly 1–1.5 GB of memory. Without swap the build OOMs on a 2 GB instance.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2c. Install system packages
```bash
sudo apt install -y ca-certificates curl build-essential
```

No Python, no Node, no WeasyPrint — the backend is a single Rust binary and the frontend is served as static files.

### 2d. Install Caddy
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

### 2e. Install and configure Redis
```bash
sudo apt install -y redis-server
```

Edit `/etc/redis/redis.conf` to add or update these lines:
```
bind 127.0.0.1
maxmemory 256mb
maxmemory-policy volatile-ttl
appendonly yes
```

Enable and start:
```bash
sudo systemctl enable --now redis-server
```

### 2f. Install Rust via rustup
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
```

---

## Phase 3 — Application Setup

### 3a. Clone the repository
```bash
cd /home/ubuntu
git clone https://github.com/YOUR_GITHUB_USERNAME/markdown_to_pdf.git
cd markdown_to_pdf
```

### 3b. Build the release binary
```bash
cd backend
cargo build --release
```

The release binary is at `backend/target/release/server`. First build takes 5–10 minutes; subsequent builds are faster thanks to incremental compilation.

### 3c. Create `backend/.env`

```bash
nano /home/ubuntu/markdown_to_pdf/backend/.env
```

```dotenv
# Server bind address and port
HOST=127.0.0.1
PORT=8000

# Redis connection URL
REDIS_URL=redis://127.0.0.1:6379

# TTL for shared documents (seconds). 604800 = 7 days.
SHARE_TTL_SECONDS=604800

# Maximum request body size in bytes (512 KB default)
MAX_BODY_BYTES=524288

# Rate limit: requests per minute per IP
RATE_LIMIT_PER_MIN=20

# Health-check alert email (Gmail with App Password)
ALERT_EMAIL=your_gmail@gmail.com
ALERT_EMAIL_PASSWORD=your_app_password

# Address that receives alert emails
ALERT_RECEIVER_EMAIL=receiver@example.com
```

---

## Phase 4 — Systemd Service (`md2pdf-api`)

```bash
sudo nano /etc/systemd/system/md2pdf-api.service
```

```ini
[Unit]
Description=Markdown-to-PDF Share API (Rust/Axum)
After=network.target redis.service
Requires=redis.service

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/markdown_to_pdf/backend
EnvironmentFile=/home/ubuntu/markdown_to_pdf/backend/.env
ExecStart=/home/ubuntu/markdown_to_pdf/backend/target/release/server
Restart=always
RestartSec=5
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now md2pdf-api
```

---

## Phase 5 — Caddy Configuration

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the entire file with:

```caddyfile
:80 {
    handle_path /api/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /assets/* {
        root * /home/ubuntu/markdown_to_pdf/frontend/dist
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }

    handle {
        root * /home/ubuntu/markdown_to_pdf/frontend/dist
        file_server
        header /index.html Cache-Control "no-cache"
        try_files {path} /index.html
    }
}
```

> **Note:** `try_files {path} /index.html` is required for the `/shared/:id` SPA route. Without it, a direct browser navigation to a share URL returns a 404 from Caddy instead of loading the app.

Restart Caddy:
```bash
sudo systemctl restart caddy
```

---

## Phase 6 — Cloudflare Tunnel

1. Go to **Cloudflare Dashboard > Zero Trust > Networks > Tunnels**.
2. Create a tunnel named `md2pdf`.
3. Add a **Public Hostname** (e.g. `app.yourdomain.com`), service type **HTTP**, URL `localhost:80`.
4. Copy and run the installation command Cloudflare provides:
```bash
sudo cloudflared service install eyJh...
```

The app is now live on the internet with HTTPS, without opening any inbound ports on EC2.

---

## Phase 7 — CI/CD (GitHub Actions)

The pipeline has two jobs:

**Job 1 — `verify-and-build`** (runs on the GitHub Actions runner):
- Installs frontend deps (`npm ci`), runs the full test suite (`npm test`), and builds the static frontend (`npm run build`).
- Uploads `frontend/dist/` as an artifact (retained 1 day).
- Runs `cargo test` and `cargo clippy -- -D warnings` for the backend.
- Deployment is blocked if either step fails.

**Job 2 — `deploy`** (runs after `verify-and-build` succeeds):
- Downloads the `frontend/dist/` artifact and syncs it to EC2 via `scp`.
- SSHes into EC2, `git fetch` + `git reset --hard origin/main`, then runs `cargo build --release` on EC2.
- Restarts `md2pdf-api` and `caddy` only after the build succeeds.

**Why build frontend on the runner, not EC2?** Vite + Mermaid + harper.js WASM bundling consumes over 1 GB of memory. Building on the t4g.small would OOM even with swap.

Add these two secrets to your GitHub repository under **Settings > Secrets and variables > Actions**:
- `EC2_HOST`: the EC2 public IP address.
- `EC2_SSH_KEY`: the contents of your `.pem` private key file.

---

## Phase 8 — Health Check System

The health check script (`backend/health_check.py`) runs nightly and optionally weekly. It checks the `/health` endpoint, runs a round-trip share test, scans systemd logs for errors, and checks disk and memory.

### Install python3-dotenv

```bash
sudo apt install -y python3-dotenv
# or: pip3 install python-dotenv
```

### Environment variables

The script reads these from `backend/.env` (already set in Phase 3):

| Variable | Purpose |
|----------|---------|
| `ALERT_EMAIL` | Gmail address used as the sender |
| `ALERT_EMAIL_PASSWORD` | Gmail App Password (not your account password) |
| `ALERT_RECEIVER_EMAIL` | Address that receives alerts and weekly reports |

> The script also falls back to the old variable names (`gmail_id`, `gmail_pw`, `alert_reciver_mail_id`) so existing `.env` files keep working without changes.

### Nightly health check service and timer

```bash
sudo nano /etc/systemd/system/md2pdf-health.service
```

```ini
[Unit]
Description=MD2PDF Nightly Health Check

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/markdown_to_pdf/backend
ExecStart=python3 /home/ubuntu/markdown_to_pdf/backend/health_check.py
```

```bash
sudo nano /etc/systemd/system/md2pdf-health.timer
```

```ini
[Unit]
Description=Run MD2PDF Health Check Nightly

[Timer]
OnCalendar=*-*-* 00:00:00 Asia/Kolkata
Persistent=true

[Install]
WantedBy=timers.target
```

### Weekly status report service and timer

```bash
sudo nano /etc/systemd/system/md2pdf-weekly.service
```

```ini
[Unit]
Description=MD2PDF Weekly Health Report

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/markdown_to_pdf/backend
ExecStart=python3 /home/ubuntu/markdown_to_pdf/backend/health_check.py --weekly
```

```bash
sudo nano /etc/systemd/system/md2pdf-weekly.timer
```

```ini
[Unit]
Description=Run MD2PDF Weekly Health Report

[Timer]
OnCalendar=Sun *-*-* 00:00:00 Asia/Kolkata
Persistent=true

[Install]
WantedBy=timers.target
```

### Enable all timers

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now md2pdf-health.timer
sudo systemctl enable --now md2pdf-weekly.timer
```

To trigger a manual run at any time:
```bash
sudo systemctl start md2pdf-health.service
sudo systemctl start md2pdf-weekly.service
```
