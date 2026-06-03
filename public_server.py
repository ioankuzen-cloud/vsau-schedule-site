from __future__ import annotations

import importlib.util
import json
import mimetypes
import os
import re
import sys
import threading
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent


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


class PublicHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text: str, content_type: str, status: int = 200) -> None:
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "private, max-age=60")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        self.wfile.write(data)

    def redirect(self, target: str) -> None:
        self.send_response(302)
        self.send_header("Location", target)
        self.end_headers()

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
                payload = module.aggregate_lessons(query)
                self.send_json(patch_api_payload(payload, site_key))
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


def main() -> None:
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    start_background_refresh()
    server = ThreadingHTTPServer((host, port), PublicHandler)
    print(f"VSAU public schedule site: http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
