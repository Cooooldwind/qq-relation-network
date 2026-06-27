import json
import os
import threading
from pathlib import Path


class DataCache:
    def __init__(self, cache_dir="../data"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._file_lock = threading.Lock()

    def _get_path(self, key):
        return self.cache_dir / f"{key}.json"

    def save(self, key, data):
        path = self._get_path(key)
        self._atomic_write(path, data)

    def _atomic_write(self, path, data):
        with self._file_lock:
            tmp_path = path.with_suffix(".tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            tmp_path.replace(path)

    def load(self, key, default=None):
        path = self._get_path(key)
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return default
        return default

    def exists(self, key):
        return self._get_path(key).exists()

    def clear(self, key=None):
        if key:
            path = self._get_path(key)
            if path.exists():
                path.unlink()
        else:
            for f in self.cache_dir.glob("*.json"):
                f.unlink()

    def append_group_members(self, group_id, members):
        key = "group_members"
        path = self._get_path(key)
        with self._file_lock:
            if path.exists():
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except (json.JSONDecodeError, IOError):
                    data = {}
            else:
                data = {}
            data[str(group_id)] = members
            tmp_path = path.with_suffix(".tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            tmp_path.replace(path)

    def get_group_members(self, group_id):
        key = "group_members"
        data = self.load(key, {})
        return data.get(str(group_id))
