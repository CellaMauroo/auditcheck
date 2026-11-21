import argparse
import json
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from assessment import validate
from report import make_report
from storage import Assessments

ROOT = Path(__file__).resolve().parent
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/catalog.json": ("catalog.json", "application/json; charset=utf-8"),
}
ITEM = re.compile(r"/api/assessments/([a-f0-9]{32})(/report\.pdf)?")
COLLECTION = "/api/assessments"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def dispatch(self, method):
        if self.headers.get("Host") not in self.server.hosts:
            return self.error(403, "Origem indisponível.")
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.origins:
            return self.error(403, "Origem indisponível.")
        path = urlsplit(self.path).path
        try:
            if method == "GET" and path in STATIC:
                name, mime = STATIC[path]
                return self.send_bytes(200, (ROOT / "web" / name).read_bytes(), mime)
            if path == COLLECTION and method == "GET":
                return self.send_json(200, self.server.store.list())
            if path == COLLECTION and method == "POST":
                body = self.read_json()
                if type(body.get("demo")) is not bool or body.keys() != {"demo"}:
                    return self.error(400, "Informe se é uma demonstração.")
                return self.send_json(201, self.server.store.create(body["demo"]))
            match = ITEM.fullmatch(path)
            if match:
                key, report = match.groups()
                record = self.server.store.get(key)
                if record is None:
                    return self.error(404, "Avaliação não encontrada.")
                if method == "GET" and report:
                    return self.send_bytes(200, make_report(record), "application/pdf",
                                           f'attachment; filename="auditcheck-{key[:8]}.pdf"')
                if method == "GET":
                    return self.send_json(200, record)
                if method == "PUT" and not report:
                    body = self.read_json()
                    revision = body.get("revision")
                    if type(revision) is not int or revision < 1:
                        return self.error(400, "Revisão inválida.")
                    data = validate(body.get("data"))
                    updated = self.server.store.update(key, revision, data)
                    if updated is None:
                        return self.error(409, "A avaliação foi alterada em outra janela. Reabra a avaliação antes de editar.")
                    return self.send_json(200, updated)
            return self.error(404, "Recurso não encontrado.")
        except ValueError as error:
            return self.error(400, str(error))

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Use Content-Type application/json.")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 256_000:
            raise ValueError("Tamanho de requisição inválido.")
        try:
            data = json.loads(self.rfile.read(length))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON inválido.") from error
        if not isinstance(data, dict):
            raise ValueError("Envie um objeto JSON.")
        return data

    def send_bytes(self, status, body, mime, disposition=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
        if disposition:
            self.send_header("Content-Disposition", disposition)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, data):
        return self.send_bytes(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def error(self, status, message):
        return self.send_json(status, {"error": message or HTTPStatus(status).phrase})


def create_server(port, database):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    port = server.server_port
    server.hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    server.origins = {f"http://{host}" for host in server.hosts}
    server.store = Assessments(database)
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Servidor local do AuditCheck")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--database", type=Path, default=ROOT / "data" / "auditcheck.sqlite3")
    args = parser.parse_args()
    with create_server(args.port, args.database) as server:
        print(f"AuditCheck disponível em http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
