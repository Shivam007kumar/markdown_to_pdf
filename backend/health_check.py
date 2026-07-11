import os
import smtplib
import subprocess
import json
import urllib.request
import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# Configuration
API_URL = "http://127.0.0.1:8000" # Test locally through the proxy on EC2, or directly to uvicorn
EMAIL_SENDER = os.getenv("gmail_id")
EMAIL_PASSWORD = os.getenv("gmail_pw")
EMAIL_RECEIVER = os.getenv("alert_reciver_mail_id")

def send_alert(subject, body):
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print(f"Skipping email alert (credentials not configured in .env): {subject}")
        print("--- Email Body ---")
        print(body)
        print("------------------")
        return
        
    try:
        msg = MIMEMultipart()
        msg['From'] = EMAIL_SENDER
        msg['To'] = EMAIL_RECEIVER
        msg['Subject'] = f"🚨 MD2PDF Alert: {subject}"
        
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"Alert email sent successfully: {subject}")
    except Exception as e:
        print(f"Failed to send alert email: {e}")

def run_health_check():
    errors = []
    
    # 1. Test basic liveness
    try:
        req = urllib.request.Request(f"{API_URL}/health")
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                errors.append(f"/health returned status {response.status}")
    except Exception as e:
        errors.append(f"Failed to connect to /health: {e}")
        
    # 2. Test actual PDF Generation functionality (Full end-to-end test)
    try:
        payload = json.dumps({
            "markdown": "# Health Check\nIf you can read this, the system is alive.",
            "custom_css": ""
        }).encode('utf-8')
        
        req = urllib.request.Request(f"{API_URL}/export", data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status != 200:
                errors.append(f"/export returned status {response.status}")
            else:
                resp_data = json.loads(response.read().decode('utf-8'))
                if "url" not in resp_data:
                    errors.append(f"/export returned successful status but no 'url' in response: {resp_data}")
    except Exception as e:
        errors.append(f"Failed end-to-end PDF export test: {e}")
        
    # 3. Check systemd logs for the last 24 hours
    try:
        # Fetch logs for the md2pdf-api service
        log_process = subprocess.run(
            ['journalctl', '-u', 'md2pdf-api', '--since', '24 hours ago', '--no-pager'],
            capture_output=True,
            text=True
        )
        logs = log_process.stdout
        
        # Look for critical keywords
        log_errors = []
        for line in logs.splitlines():
            line_lower = line.lower()
            if 'error' in line_lower or 'exception' in line_lower or 'traceback' in line_lower:
                # Filter out false positives
                if "weasyprint" in line_lower and "ignored" in line_lower:
                    continue
                if "no entries" in line_lower:
                    continue
                log_errors.append(line)
                
        if log_errors:
            # We only send the last 10 errors to avoid huge emails
            error_preview = "\n".join(log_errors[-10:])
            errors.append(f"Found {len(log_errors)} error(s) in systemd logs (last 24h). Preview of last 10:\n{error_preview}")
    except Exception as e:
        errors.append(f"Failed to scan systemd logs: {e}")
        
    # Send alert if any issues were found
    if errors:
        body = f"MD2PDF Health Check Failed at {datetime.datetime.now().isoformat()}\n\n"
        body += "Issues detected:\n"
        for i, err in enumerate(errors, 1):
            body += f"{i}. {err}\n\n"
        
        send_alert("System Health Check Failed", body)
    else:
        print("Health check passed. No errors found.")

if __name__ == "__main__":
    run_health_check()
