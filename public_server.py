from __future__ import annotations

import importlib.util
import hashlib
import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_ORIGIN = "https://www.vsau-schedule.ru"


SITES = {
    "students": {
        "title": "Студенты",
        "module": ROOT_DIR / "vsau_schedule_site" / "server.py",
        "static": ROOT_DIR / "vsau_schedule_site" / "static",
    },
    "teachers": {
        "title": "Преподаватели",
        "module": ROOT_DIR / "vsau_teacher_schedule_site" / "server.py",
        "static": ROOT_DIR / "vsau_teacher_schedule_site" / "static",
    },
    "rooms": {
        "title": "Аудитории",
        "module": ROOT_DIR / "vsau_room_schedule_site" / "server.py",
        "static": ROOT_DIR / "vsau_room_schedule_site" / "static",
    },
}

ROUTE_RE = re.compile(r"/(students|teachers|rooms)(/.*)?")
SCHEDULE_RE = re.compile(r"/api/schedule/([^/]+)")
FILE_RE = re.compile(r"/api/file/([^/]+)")
DEFAULT_AGGREGATE_QUERY = {"semester": ["II семестр"], "section": ["Основное расписание"]}
AGGREGATE_JOB_TTL_SECONDS = 12 * 60 * 60
ROBOTS_TXT = f"""User-agent: *
Allow: /

Sitemap: {PUBLIC_ORIGIN}/sitemap.xml
"""
SITEMAP_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{PUBLIC_ORIGIN}/students/</loc><priority>1.0</priority></url>
  <url><loc>{PUBLIC_ORIGIN}/teachers/</loc><priority>0.8</priority></url>
  <url><loc>{PUBLIC_ORIGIN}/rooms/</loc><priority>0.8</priority></url>
</urlset>
"""

aggregate_jobs: dict[str, dict[str, Any]] = {}
aggregate_lock = threading.Lock()


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"vsau_public_{name}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


for site_key, config in SITES.items():
    config["loaded"] = load_module(site_key, config["module"])  # type: ignore[index]


def public_path(site_key: str, api_path: str) -> str:
    return f"/{site_key}{api_path}"


def patch_api_payload(payload: Any, site_key: str) -> Any:
    if isinstance(payload, dict):
        result = {key: patch_api_payload(value, site_key) for key, value in payload.items()}
        preview_url = result.get("previewUrl")
        if isinstance(preview_url, str) and preview_url.startswith("/api/"):
            result["previewUrl"] = public_path(site_key, preview_url)
        return result
    if isinstance(payload, list):
        return [patch_api_payload(item, site_key) for item in payload]
    return payload


def aggregate_module_for_site(site_key: str) -> tuple[str, ModuleType]:
    # The teacher and room pages use the same parsed lesson data. Sharing one
    # aggregate job prevents Render Free from parsing the same 106 files twice.
    aggregate_site = "teachers" if site_key in {"teachers", "rooms"} else site_key
    module: ModuleType = SITES[aggregate_site]["loaded"]  # type: ignore[assignment]
    return aggregate_site, module


def aggregate_job_key(site_key: str, query: dict[str, list[str]]) -> str:
    relevant = {
        key: query.get(key, [""])
        for key in ("faculty", "semester", "section", "refreshTree", "refreshFiles")
    }
    payload = {"site": site_key, "query": relevant}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def aggregate_status_payload(job: dict[str, Any]) -> dict[str, Any]:
    elapsed = max(0, int(time.time() - float(job.get("startedAt", time.time()))))
    return {
        "pending": True,
        "status": "running",
        "startedAt": job.get("startedAt"),
        "elapsedSeconds": elapsed,
        "message": "Расписание собирается на сервере. Страница обновит результат автоматически.",
    }


def run_aggregate_job(job_key: str, module: ModuleType, query: dict[str, list[str]]) -> None:
    try:
        payload = module.aggregate_lessons(query)
        with aggregate_lock:
            aggregate_jobs[job_key] = {
                "status": "done",
                "payload": payload,
                "startedAt": aggregate_jobs.get(job_key, {}).get("startedAt", time.time()),
                "finishedAt": time.time(),
            }
    except Exception as exc:
        with aggregate_lock:
            aggregate_jobs[job_key] = {
                "status": "error",
                "error": str(exc),
                "startedAt": aggregate_jobs.get(job_key, {}).get("startedAt", time.time()),
                "finishedAt": time.time(),
            }


def aggregate_async(site_key: str, query: dict[str, list[str]]) -> tuple[dict[str, Any], int]:
    aggregate_site, module = aggregate_module_for_site(site_key)
    job_key = aggregate_job_key(aggregate_site, query)
    now = time.time()

    with aggregate_lock:
        job = aggregate_jobs.get(job_key)
        if job and job.get("status") == "done":
            finished_at = float(job.get("finishedAt", now))
            if now - finished_at < AGGREGATE_JOB_TTL_SECONDS:
                return job["payload"], 200
            aggregate_jobs.pop(job_key, None)
            job = None
        if job and job.get("status") == "error":
            aggregate_jobs.pop(job_key, None)
            job = None
        if job and job.get("status") == "running":
            return aggregate_status_payload(job), 202

        query_copy = {key: list(value) for key, value in query.items()}
        job = {"status": "running", "startedAt": now}
        aggregate_jobs[job_key] = job
        thread = threading.Thread(target=run_aggregate_job, args=(job_key, module, query_copy), daemon=True)
        thread.start()
        return aggregate_status_payload(job), 202


class PublicHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def write_body(self, body: bytes) -> None:
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_body(body)

    def send_text(self, text: str, content_type: str, status: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "private, max-age=60")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_body(body)

    def send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        if path.suffix.lower() == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif path.suffix.lower() == ".html":
            content_type = "text/html; charset=utf-8"
        elif path.suffix.lower() == ".css":
            content_type = "text/css; charset=utf-8"
        else:
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "private, max-age=300")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.write_body(data)

    def redirect(self, target: str) -> None:
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        path = parsed.path

        if path in {"", "/"}:
            suffix = f"?{parsed.query}" if parsed.query else ""
            self.redirect(f"/students/{suffix}")
            return

        if path == "/health":
            self.send_json({"ok": True, "sites": list(SITES.keys())})
            return

        if path == "/robots.txt":
            self.send_text(ROBOTS_TXT, "text/plain; charset=utf-8")
            return

        if path == "/sitemap.xml":
            self.send_text(SITEMAP_XML, "application/xml; charset=utf-8")
            return

        site_match = ROUTE_RE.fullmatch(path)
        if not site_match:
            self.send_error(404)
            return

        site_key = site_match.group(1)
        site_path = site_match.group(2) or "/"
        config = SITES[site_key]
        module: ModuleType = config["loaded"]  # type: ignore[assignment]

        if site_path == "":
            self.redirect(f"/{site_key}/")
            return
        if site_path == "/" and path != f"/{site_key}/":
            suffix = f"?{parsed.query}" if parsed.query else ""
            self.redirect(f"/{site_key}/{suffix}")
            return

        try:
            if site_path == "/api/tree":
                payload = module.api_tree(force=query.get("refresh", ["0"])[0] == "1")
                self.send_json(patch_api_payload(payload, site_key))
                return

            if site_path == "/api/aggregate" and hasattr(module, "aggregate_lessons"):
                payload, status = aggregate_async(site_key, query)
                self.send_json(patch_api_payload(payload, site_key), status=status)
                return

            schedule_match = SCHEDULE_RE.fullmatch(site_path)
            if schedule_match:
                payload = module.api_schedule(query, schedule_match.group(1))
                self.send_json(patch_api_payload(payload, site_key))
                return

            file_match = FILE_RE.fullmatch(site_path)
            if file_match and hasattr(module, "send_cached_file"):
                module.send_cached_file(self, query, file_match.group(1))
                return

            if site_path in {"/", "/index.html"}:
                html_path = config["static"] / "index.html"  # type: ignore[operator]
                self.send_file(html_path)
                return

            asset_name = site_path.lstrip("/")
            asset_path = (config["static"] / asset_name).resolve()  # type: ignore[operator]
            static_dir = Path(config["static"]).resolve()  # type: ignore[arg-type]
            if static_dir not in asset_path.parents:
                self.send_error(403)
                return
            self.send_file(asset_path)
        except getattr(module, "ApiError", Exception) as exc:
            status = getattr(exc, "status", 500)
            self.send_json({"error": str(exc)}, status=status)
        except urllib.error.URLError as exc:
            self.send_json({"error": f"Ошибка сети при обращении к Google Drive: {exc}"}, status=502)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)


def start_background_refresh() -> None:
    seen: set[int] = set()
    for config in SITES.values():
        module: ModuleType = config["loaded"]  # type: ignore[assignment]
        refresh = getattr(module, "background_refresh", None)
        if callable(refresh) and id(refresh) not in seen:
            seen.add(id(refresh))
            threading.Thread(target=refresh, daemon=True).start()


def start_default_aggregate_warmup() -> None:
    aggregate_async("teachers", DEFAULT_AGGREGATE_QUERY)


def main() -> None:
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    start_background_refresh()
    start_default_aggregate_warmup()
    server = ThreadingHTTPServer((host, port), PublicHandler)
    print(f"VSAU public schedule site: http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
