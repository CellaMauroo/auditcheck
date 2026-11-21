import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from server import create_server


class AuditCheckIntegrationTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.database = Path(temp.name) / "test.sqlite3"
        self.server = create_server(0, self.database)
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(self.server.shutdown)
        self.opener = build_opener(ProxyHandler({}))

    def request(self, path, method="GET", payload=None, expected=200):
        body = None if payload is None else json.dumps(payload).encode()
        request = Request(self.base + path, body, {"Content-Type": "application/json"}, method=method)
        try:
            response = self.opener.open(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            self.assertEqual(response.status, expected, raw[:200])
            if response.headers.get_content_type() == "application/json":
                return json.loads(raw)
            return raw, response.headers

    def test_assessment_lifecycle(self):
        self.assertEqual(self.request("/api/assessments"), [])
        demo = self.request("/api/assessments", "POST", {"demo": True}, 201)
        self.assertEqual(demo["summary"]["score"], 60)
        saved = self.request("/api/assessments", "POST", {"demo": False}, 201)
        self.assertIsNone(saved["summary"]["score"])
        path = "/api/assessments/" + saved["id"]
        data = saved["data"]
        data["org"]["name"] = "Organização de teste"
        data["answers"] = {
            "0": {"value": "na", "reason": "Fora do escopo"},
            "1": {"value": "0", "evidence": "SIM-01"},
            "2": {"value": "4"},
            "3": {"value": "na", "reason": " "},
        }
        data["actions"] = {"1": {"owner": "Equipe", "stage0": True, "due": "2026-12-10"}}
        update = {"revision": saved["revision"], "data": data}
        updated = self.request(path, "PUT", update)
        self.assertEqual(updated["summary"]["score"], 25)
        self.assertEqual(updated["summary"]["answered"], 3)
        self.assertEqual(updated["summary"]["findings"][0]["priority"], 9)
        self.request(path, "PUT", update, 409)
        pdf, headers = self.request(path + "/report.pdf")
        self.assertEqual(headers.get_content_type(), "application/pdf")
        self.assertIn("attachment", headers.get("Content-Disposition"))
        self.assertTrue(pdf.startswith(b"%PDF"))
        with create_server(0, self.database) as reopened:
            self.assertEqual(reopened.store.get(saved["id"]), updated)
            self.assertEqual(len(reopened.store.list()), 2)

    def test_invalid_replies_are_rejected(self):
        record = self.request("/api/assessments", "POST", {"demo": False}, 201)
        path = "/api/assessments/" + record["id"]
        data = record["data"]
        data["answers"]["0"] = {"value": []}
        self.request(path, "PUT", {"revision": 1, "data": data}, 400)
        self.assertEqual(self.request(path)["revision"], 1)


if __name__ == "__main__":
    unittest.main()
