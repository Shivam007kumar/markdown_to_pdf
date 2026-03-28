# Markdown-to-PDF: EC2 Deployment Guide

This guide covers the entire lifecycle of deploying the application to AWS using a single-box architecture.

> [!NOTE]
> **Tech Stack Overview**
> *   **Server:** AWS EC2 (`t4g.small` ARM64 - 2GB RAM)
> *   **Frontend:** React / Vite (Compiled Static Files)
> *   **Backend:** Python / FastAPI / WeasyPrint
> *   **Web Server:** Caddy
> *   **Process Manager:** Systemd + Uvicorn
> *   **Ingress / SSL:** Cloudflare Tunnel
> *   **CI/CD:** GitHub Actions

---

## Phase 1: Provisioning the AWS EC2 Instance

1. Log in to the **AWS Console** and navigate to **EC2 > Instances > Launch instances**.
2. **Name:** `markdown-to-pdf-prod`
3. **Application and OS Images (AMI):** Select **Ubuntu Server 24.04 LTS** (or 22.04). Ensure you change the architecture to **64-bit (Arm)**.
4. **Instance Type:** Select **`t4g.small`**. This provides 2 GB of RAM, which is the minimum recommended for WeasyPrint to avoid Out-of-Memory (OOM) errors.
5. **Key Pair:** Create a new key pair (e.g., `md2pdf-key.pem`) and download it. You will need this to SSH later.
6. **Network Settings:** You **only** need to allow SSH traffic (Port 22) from your IP. Cloudflare handles HTTP/HTTPS securely without needing open web ports.
7. **Configure Storage:** `10 GB` (`gp3`).
8. Click **Launch Instance**.

---

## Phase 2: Server Preparation

SSH into your new instance:
```bash
ssh -i /path/to/md2pdf-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

Run the following commands to install all the system dependencies:

### 1. Update Packages
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Python, Pip, and WeasyPrint System Dependencies
WeasyPrint requires specific C-libraries to generate PDFs (Pango, GDK-Pixbuf, etc.).
```bash
sudo apt install -y python3-pip python3-venv \
    libpango-1.0-0 libharfbuzz0b libpangoft2-1.0-0 libffi-dev \
    libjpeg-dev libopenjp2-7-dev fontconfig
```

### 3. Install Node.js (for the Frontend Build)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4. Install Caddy (Web Server)
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

---

## Phase 3: Application Setup

### 1. Clone the Codebase
```bash
cd /home/ubuntu
git clone https://github.com/YOUR_GITHUB_USERNAME/markdown_to_pdf.git
cd markdown_to_pdf
```

### 2. Prepare the Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create your production environment File:
```bash
nano .env
```
Paste in your AWS keys:
```
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=ap-south-1
S3_BUCKET_NAME=your-bucket-name
PORT=8000
HOST=127.0.0.1
```
*(Press `CTRL+X`, `Y`, `Enter` to save)*

### 3. Build the Frontend
```bash
cd /home/ubuntu/markdown_to_pdf/frontend
npm install
npm run build
```

---

## Phase 4: Running the Backend (Systemd)

We don't want to run Uvicorn manually and have it die when we close the terminal. Instead, we'll create a background service.

Create a new service file:
```bash
sudo nano /etc/systemd/system/md2pdf-api.service
```

Paste the following:
```ini
[Unit]
Description=Markdown to PDF FastAPI Application
After=network.target

[Service]
User=ubuntu
Group=www-data
WorkingDirectory=/home/ubuntu/markdown_to_pdf/backend
Environment="PATH=/home/ubuntu/markdown_to_pdf/backend/venv/bin"
ExecStart=/home/ubuntu/markdown_to_pdf/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 3

[Install]
WantedBy=multi-user.target
```
> [!TIP]
> Setting `--workers 3` limits concurrency, ensuring WeasyPrint never consumes all of your 2GB of memory and crashes your server.

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl start md2pdf-api
sudo systemctl enable md2pdf-api
```

---

## Phase 5: Configuring Caddy

Replace the default Caddy configuration:
```bash
sudo nano /etc/caddy/Caddyfile
```

Delete everything and paste this:
```caddyfile
:80 {
    # Forward all /api requests to our Python backend
    handle_path /api/* {
        reverse_proxy 127.0.0.1:8000
    }

    # Serve the compiled React Frontend for everything else
    handle {
        root * /home/ubuntu/markdown_to_pdf/frontend/dist
        file_server
        try_files {path} /index.html
    }
}
```

Restart Caddy:
```bash
sudo systemctl restart caddy
```

At this point, your whole application is running perfectly on your EC2 instance!

---

## Phase 6: Cloudflare Tunnel

To get this on the public internet securely (with an SSL certificate), use Cloudflare Tunnels so you don't even need open ports on AWS.

1. Go to the **Cloudflare Dashboard > Zero Trust > Networks > Tunnels**.
2. Create a tunnel and name it `md2pdf`.
3. Select **Public Hostname** (e.g., `app.yourdomain.com`).
4. **Service Type:** HTTP, **URL:** `localhost:80`
5. Cloudflare will give you a long installation command. Copy it and run it on your EC2 instance. Example:
```bash
sudo cloudflared service install eyJh...
```
*(Your app is now live on the internet!)*

---

## Phase 7: Automating Deployments (GitHub Actions)

So you never have to SSH manually again, add this CI/CD pipeline.

1. In your GitHub repository, go to **Settings > Secrets and variables > Actions**.
2. Add three New Repository Secrets:
   * `EC2_HOST`: Your EC2 Public IP address.
   * `EC2_SSH_KEY`: The contents of your downloaded `.pem` file.
3. In your local codebase IDE, create the file `.github/workflows/deploy.yml` and paste:

```yaml
name: Deploy to EC2

on:
  push:
    branches: [ "main" ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: SSH into EC2 and update Server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ubuntu
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /home/ubuntu/markdown_to_pdf
            git pull origin main
            
            # Rebuild Frontend
            cd frontend
            npm install
            npm run build
            
            # Update Backend
            cd ../backend
            source venv/bin/activate
            pip install -r requirements.txt
            
            # Restart Services
            sudo systemctl restart md2pdf-api
            sudo systemctl restart caddy
```

Commit this to GitHub. Boom, you're officially deployed and automated!
