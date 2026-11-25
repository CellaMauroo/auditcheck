import argparse
import base64
import json
import os
import re
from hmac import compare_digest
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from assessment import validate, validate_organization
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

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        path = urlsplit(self.path).path
        host = self.headers.get("Host")
        if method == "GET" and path == "/health" and (host in self.server.hosts or (
            self.server.railway and host == "healthcheck.railway.app"
        )):
            return self.send_json(200, {"status": "ok"})
        if host not in self.server.hosts:
            return self.error(403, "Origem indisponível.")
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.origins:
            return self.error(403, "Origem indisponível.")
        auth = self.server.authorization
        if auth and not compare_digest(self.headers.get("Authorization", "").encode("latin-1"), auth):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="AuditCheck", charset="UTF-8"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        try:
            if method == "GET" and path in STATIC:
                name, mime = STATIC[path]
                return self.send_bytes(200, (ROOT / "web" / name).read_bytes(), mime)
            if path == COLLECTION and method == "GET":
                return self.send_json(200, self.server.store.list())
            if path == COLLECTION and method == "POST":
                body = self.read_json()
                demo = body.get("demo")
                if type(demo) is not bool or body.keys() - {"demo", "org"}:
                    return self.error(400, "Informe se é uma demonstração.")
                organization = None
                if "org" in body:
                    if demo:
                        return self.error(400, "Cadastros de demonstração usam os dados de exemplo.")
                    organization = validate_organization(body["org"])
                    organization = {name: value.strip() for name, value in organization.items()}
                    if not organization["name"] or not organization["scope"]:
                        return self.error(400, "Preencha o nome da organização e o escopo.")
                return self.send_json(201, self.server.store.create(demo, organization))
            match = ITEM.fullmatch(path)
            if match:
                key, report = match.groups()
                if method == "DELETE" and not report:
                    body = self.read_json()
                    revision = body.get("revision")
                    if body.keys() != {"revision"} or type(revision) is not int or revision < 1:
                        return self.error(400, "Revisão inválida.")
                    deleted = self.server.store.delete(key, revision)
                    if deleted is None:
                        return self.error(404, "Avaliação não encontrada.")
                    if not deleted:
                        return self.error(409, "A avaliação foi alterada. Atualize a lista e confira antes de excluir.")
                    return self.send_json(200, {"deleted": True})
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


def create_server(port, database, *, railway=False, domain="", password=""):
    if railway and not password:
        raise ValueError("Defina AUDITCHECK_PASSWORD antes de iniciar no Railway.")
    if domain and not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", domain):
        raise ValueError("Domínio do Railway inválido.")
    server = ThreadingHTTPServer(("0.0.0.0" if railway else "127.0.0.1", port), Handler)
    port = server.server_port
    server.hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    server.origins = {f"http://{host}" for host in server.hosts}
    server.railway = railway
    server.authorization = b"Basic " + base64.b64encode(f"auditcheck:{password}".encode()) if railway else b""
    if railway and domain:
        server.hosts.add(domain)
        server.origins.add(f"https://{domain}")
    server.store = Assessments(database)
    return server


if __name__ == "__main__":
    railway = bool(os.environ.get("RAILWAY_ENVIRONMENT_ID"))
    mount = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH")
    parser = argparse.ArgumentParser(description="Servidor do AuditCheck")
    parser.add_argument("--port", type=int, default=os.environ.get("PORT", "8000"))
    parser.add_argument("--database", type=Path, default=Path(mount) / "auditcheck.sqlite3" if mount else None)
    args = parser.parse_args()
    if railway and not mount:
        parser.error("Anexe um volume persistente ao serviço para armazenar as avaliações.")
    database = args.database or ROOT / "data" / "auditcheck.sqlite3"
    with create_server(args.port, database, railway=railway,
                       domain=os.environ.get("RAILWAY_PUBLIC_DOMAIN", ""),
                       password=os.environ.get("AUDITCHECK_PASSWORD", "")) as server:
        print(f"AuditCheck escutando na porta {server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
