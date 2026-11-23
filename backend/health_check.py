import os
import smtplib
import subprocess
import json
import urllib.request
import datetime
import argparse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Load .env — use python3-dotenv if available, otherwise parse manually
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
except ImportError:
    _env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith('#') and '=' in _line:
                    _k, _, _v = _line.partition('=')
                    os.environ.setdefault(_k.strip(), _v.strip())

API_URL = "http://127.0.0.1:8000"

# Support both new and old env var names, new takes priority
EMAIL_SENDER = os.getenv("ALERT_EMAIL") or os.getenv("gmail_id")
EMAIL_PASSWORD = os.getenv("ALERT_EMAIL_PASSWORD") or os.getenv("gmail_pw")
EMAIL_RECEIVER = os.getenv("ALERT_RECEIVER_EMAIL") or os.getenv("alert_reciver_mail_id")


def send_alert(subject, body):
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print(f"Skipping email alert (credentials not configured): {subject}")
        print("--- Email Body ---")
        print(body)
        print("------------------")
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = EMAIL_SENDER
        msg['To'] = EMAIL_RECEIVER
        msg['Subject'] = f"MD2PDF Alert: {subject}"

        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"Alert email sent: {subject}")
    except Exception as e:
        print(f"Failed to send alert email: {e}")


def check_health_endpoint():
    """GET /health → assert HTTP 200 and JSON body contains "redis": "ok"."""
    errors = []
    try:
        req = urllib.request.Request(f"{API_URL}/health")
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                errors.append(f"/health returned status {response.status}")
                return errors
            body = json.loads(response.read().decode('utf-8'))
            if body.get("redis") != "ok":
                errors.append(f"/health redis status not ok: {body}")
    except Exception as e:
        errors.append(f"Failed to connect to /health: {e}")
    return errors


def check_share_roundtrip():
    """POST /share then GET /share/{id} and verify title and markdown match."""
    errors = []
    test_title = "Health Check Title"
    test_markdown = "# Health Check\n\nRound-trip test at " + datetime.datetime.now().isoformat()
    try:
        payload = json.dumps({
            "title": test_title,
            "markdown": test_markdown
        }).encode('utf-8')
        req = urllib.request.Request(
            f"{API_URL}/share",
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                errors.append(f"POST /share returned status {response.status}")
                return errors
            share_data = json.loads(response.read().decode('utf-8'))
            share_id = share_data.get("id")
            if not share_id:
                errors.append(f"POST /share returned no id: {share_data}")
                return errors
    except Exception as e:
        errors.append(f"Failed POST /share: {e}")
        return errors

    try:
        req = urllib.request.Request(f"{API_URL}/share/{share_id}")
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                errors.append(f"GET /share/{share_id} returned status {response.status}")
                return errors
            retrieved = json.loads(response.read().decode('utf-8'))
            if retrieved.get("title") != test_title:
                errors.append(
                    f"Round-trip title mismatch: expected {test_title!r}, got {retrieved.get('title')!r}"
                )
            if retrieved.get("markdown") != test_markdown:
                errors.append(
                    f"Round-trip markdown mismatch: expected {test_markdown!r}, got {retrieved.get('markdown')!r}"
                )
    except Exception as e:
        errors.append(f"Failed GET /share/{share_id}: {e}")
    return errors


def check_logs(is_weekly=False):
    """Scan journalctl for panic/ERROR lines; return (errors_list, log_errors_list)."""
    errors = []
    log_errors = []
    since = '7 days ago' if is_weekly else '24 hours ago'
    try:
        result = subprocess.run(
            ['journalctl', '-u', 'md2pdf-api', '--since', since, '--no-pager'],
            capture_output=True,
            text=True
        )
        for line in result.stdout.splitlines():
            if any(kw in line for kw in ('panic', 'PANIC', 'ERROR', 'error')):
                if 'no entries' in line.lower():
                    continue
                log_errors.append(line)
        if log_errors:
            preview = "\n".join(log_errors[-10:])
            errors.append(
                f"Found {len(log_errors)} error line(s) in journalctl (since {since}). Last 10:\n{preview}"
            )
    except Exception as e:
        errors.append(f"Failed to scan journalctl: {e}")
    return errors, log_errors


def check_disk():
    """Assert disk used% < 85%."""
    errors = []
    disk_info = ""
    try:
        result = subprocess.run(['df', '-h', '/'], capture_output=True, text=True)
        disk_info = result.stdout.strip()
        # Parse the Use% column from the second line
        lines = disk_info.splitlines()
        if len(lines) >= 2:
            parts = lines[1].split()
            use_pct_str = parts[4].rstrip('%')
            use_pct = int(use_pct_str)
            if use_pct >= 85:
                errors.append(f"Disk usage is at {use_pct}% (threshold: 85%)\n{disk_info}")
    except Exception as e:
        errors.append(f"Failed to check disk usage: {e}")
    return errors, disk_info


def check_memory():
    """Read /proc/meminfo and return a summary string."""
    summary = ""
    try:
        with open('/proc/meminfo', 'r') as f:
            meminfo = f.read()
        values = {}
        for line in meminfo.splitlines():
            parts = line.split()
            if parts[0].rstrip(':') in ('MemAvailable', 'SwapTotal', 'SwapFree'):
                values[parts[0].rstrip(':')] = int(parts[1])  # kB
        mem_avail_mb = values.get('MemAvailable', 0) // 1024
        swap_total_mb = values.get('SwapTotal', 0) // 1024
        swap_free_mb = values.get('SwapFree', 0) // 1024
        summary = f"RAM available: {mem_avail_mb} MB | Swap: {swap_free_mb}/{swap_total_mb} MB free"
    except Exception as e:
        summary = f"Could not read /proc/meminfo: {e}"
    return summary


def run_health_check(is_weekly=False):
    errors = []

    health_errors = check_health_endpoint()
    errors.extend(health_errors)

    share_errors = check_share_roundtrip()
    share_ok = len(share_errors) == 0
    errors.extend(share_errors)

    log_errors_list, raw_log_errors = check_logs(is_weekly)
    errors.extend(log_errors_list)

    disk_errors, disk_info = check_disk()
    errors.extend(disk_errors)

    mem_summary = check_memory()

    if is_weekly:
        try:
            uptime_result = subprocess.run(['uptime', '-p'], capture_output=True, text=True)
            uptime_str = uptime_result.stdout.strip()
        except Exception:
            uptime_str = "unavailable"

        log_status = (
            f"No errors found in the last 7 days."
            if not raw_log_errors
            else f"{len(raw_log_errors)} error line(s) found in the last 7 days."
        )

        body = (
            f"MD2PDF Weekly Status Report\n"
            f"Generated: {datetime.datetime.now().isoformat()}\n\n"
            f"Uptime: {uptime_str}\n\n"
            f"Round-trip share test: {'PASSED' if share_ok else 'FAILED'}\n\n"
            f"Memory/Disk:\n"
            f"  {mem_summary}\n"
            f"  Disk: {disk_info}\n\n"
            f"Log status: {log_status}\n"
        )
        if errors:
            body += "\nIssues detected:\n"
            for i, err in enumerate(errors, 1):
                body += f"{i}. {err}\n"
            send_alert("Weekly Status Report: Issues Detected", body)
        else:
            send_alert("Weekly Status Report: All Clear", body)
    else:
        if errors:
            body = f"MD2PDF Health Check Failed at {datetime.datetime.now().isoformat()}\n\n"
            body += "Issues detected:\n"
            for i, err in enumerate(errors, 1):
                body += f"{i}. {err}\n\n"
            send_alert("System Health Check Failed", body)
        else:
            print("Health check passed. No errors found.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MD2PDF Health Check")
    parser.add_argument("--weekly", action="store_true", help="Run the weekly summary report")
    args = parser.parse_args()

    run_health_check(is_weekly=args.weekly)
