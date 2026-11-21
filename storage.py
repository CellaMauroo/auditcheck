import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from uuid import uuid4

from assessment import CATALOG, summarize


class Assessments:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with closing(self.connect()) as db, db:
            db.execute("PRAGMA journal_mode = WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS assessments (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                revision INTEGER NOT NULL, payload TEXT NOT NULL
            )""")

    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def create(self, demo):
        data = CATALOG["demo"] if demo else {
            "demo": False, "org": dict.fromkeys(("name", "sector", "owner", "scope"), ""),
            "answers": {}, "actions": {},
        }
        key, now = uuid4().hex, datetime.now(timezone.utc).isoformat()
        with closing(self.connect()) as db, db:
            db.execute("INSERT INTO assessments VALUES (?, ?, ?, 1, ?)", (key, now, now, json.dumps(data)))
        return self.get(key)

    @staticmethod
    def unpack(row):
        if row is None:
            return None
        record = dict(row)
        record["data"] = json.loads(record.pop("payload"))
        record["summary"] = summarize(record["data"])
        return record

    def list(self):
        with closing(self.connect()) as db:
            rows = db.execute("SELECT * FROM assessments ORDER BY updated_at DESC, id").fetchall()
        result = []
        for row in rows:
            record = self.unpack(row)
            result.append({"id": record["id"], "updated_at": record["updated_at"],
                           "name": record["data"]["org"]["name"], "demo": record["data"]["demo"],
                           "score": record["summary"]["score"], "answered": record["summary"]["answered"]})
        return result

    def get(self, key):
        with closing(self.connect()) as db:
            return self.unpack(db.execute("SELECT * FROM assessments WHERE id = ?", (key,)).fetchone())

    def update(self, key, revision, data):
        now = datetime.now(timezone.utc).isoformat()
        with closing(self.connect()) as db, db:
            updated = db.execute(
                "UPDATE assessments SET payload=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=?",
                (json.dumps(data), now, key, revision),
            )
            if updated.rowcount == 0:
                return None
            return self.unpack(db.execute("SELECT * FROM assessments WHERE id = ?", (key,)).fetchone())
