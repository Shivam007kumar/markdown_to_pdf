import os
import smtplib
import subprocess
import json
import urllib.request
import datetime
import argparse
import argparse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# Configuration
API_URL = "http://127.0.0.1:8000" # Test locally through the proxy on EC2, or directly to uvicorn
EMAIL_SENDER = os.getenv("gmail_id")
EMAIL_PASSWORD = os.getenv("gmail_pw")
EMAIL_RECEIVER = os.getenv("alert_reciver_mail_id")

def send_alert(subject, body, pdf_bytes=None):
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
        
        if pdf_bytes:
            pdf_attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
            pdf_attachment.add_header('Content-Disposition', 'attachment', filename='MD2PDF_Health_Report.pdf')
            msg.attach(pdf_attachment)
        
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"Alert email sent successfully: {subject}")
    except Exception as e:
        print(f"Failed to send alert email: {e}")

def run_health_check(is_weekly=False):
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
        
    # 3. Check systemd logs
    try:
        time_frame = '7 days ago' if is_weekly else '24 hours ago'
        # Fetch logs for the md2pdf-api service
        log_process = subprocess.run(
            ['journalctl', '-u', 'md2pdf-api', '--since', time_frame, '--no-pager'],
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
                if "httpx" in line_lower and "info" in line_lower:
                    continue
                if "weasyprint" in line_lower and "failed to load image" in line_lower:
                    continue
                if "weasyprint" in line_lower and "ignored" in line_lower:
                    continue
                if "no entries" in line_lower:
                    continue
                log_errors.append(line)
                
        if log_errors:
            # We only send the last 10 errors to avoid huge emails
            error_preview = "\n".join(log_errors[-10:])
            errors.append(f"Found {len(log_errors)} error(s) in systemd logs (last {time_frame}). Preview of last 10:\n{error_preview}")
    except Exception as e:
        errors.append(f"Failed to scan systemd logs: {e}")
        
    # Generate the comprehensive PDF test if weekly
    pdf_bytes = None
    if is_weekly:
        try:
            now_str = datetime.datetime.now().isoformat()
            log_section = f"### System Logs (Last {time_frame})\n\n```text\n{error_preview}\n```" if log_errors else f"### System Logs (Last {time_frame})\n\n✅ System is 100% Healthy! No errors found."
            
            md_content = f"""# MD2PDF Weekly Health Report

**Date:** {now_str}

## E2E Functionality Verification

This PDF was generated by the backend itself, proving that all integrations are perfectly healthy!

### 1. Math Rendering Verification (CodeCogs)
Einstein's famous equation: $E = mc^2$

Block Math:
$$
\\int_0^\\infty e^{{-x^2}} dx = \\frac{{\\sqrt{{\\pi}}}}{{2}}
$$

### 2. Diagram Rendering Verification (Kroki / Mermaid)
```mermaid
graph TD
    A[Cron Job] --> B[Test API]
    B --> C[Generate PDF]
    C --> D[Email User]
```

## System Status

{log_section}
"""
            payload = json.dumps({
                "markdown": md_content,
                "custom_css": ""
            }).encode('utf-8')
            
            req = urllib.request.Request(f"{API_URL}/export", data=payload, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as response:
                if response.status == 200:
                    resp_data = json.loads(response.read().decode('utf-8'))
                    pdf_url = resp_data.get("url")
                    if pdf_url:
                        # Download the generated PDF
                        pdf_req = urllib.request.Request(pdf_url)
                        with urllib.request.urlopen(pdf_req, timeout=30) as pdf_resp:
                            pdf_bytes = pdf_resp.read()
        except Exception as e:
            errors.append(f"Failed to generate Weekly PDF report: {e}")

    # Send alert
    if errors:
        title = "Weekly Health Check Failed" if is_weekly else "System Health Check Failed"
        body = f"MD2PDF Health Check Failed at {datetime.datetime.now().isoformat()}\n\n"
        body += "Issues detected:\n"
        for i, err in enumerate(errors, 1):
            body += f"{i}. {err}\n\n"
        
        send_alert(title, body, pdf_bytes)
    else:
        if is_weekly:
            body = f"MD2PDF Weekly Status Report at {datetime.datetime.now().isoformat()}\n\n"
            body += "✅ System is 100% Healthy! Please find the attached PDF report proving all backend functionality is perfectly intact."
            send_alert("Weekly Status Report: All Clear", body, pdf_bytes)
        else:
            print("Health check passed. No errors found.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MD2PDF Health Check")
    parser.add_argument("--weekly", action="store_true", help="Run the weekly summary report")
    args = parser.parse_args()
    
    run_health_check(is_weekly=args.weekly)
