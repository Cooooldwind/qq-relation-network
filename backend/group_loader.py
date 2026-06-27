import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from qq_client import QQClient
from cache import DataCache


class GroupMemberLoader:
    def __init__(self, qq_client: QQClient, cache: DataCache, max_workers=3):
        self.qq_client = qq_client
        self.cache = cache
        self.max_workers = max_workers
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._executor = None
        self._futures = []
        self.state = {
            "status": "idle",
            "total_groups": 0,
            "completed_groups": 0,
            "failed_groups": [],
            "current_groups": [],
            "results": {},
            "group_list": []
        }

    def _update_state(self, **kwargs):
        with self._lock:
            self.state.update(kwargs)

    def _load_single_group(self, group_id, group_name=""):
        if self._stop_event.is_set():
            return None
        with self._lock:
            if group_id not in self.state["current_groups"]:
                self.state["current_groups"].append(group_id)
        try:
            cached = self.cache.get_group_members(group_id)
            if cached:
                with self._lock:
                    self.state["results"][str(group_id)] = cached
                    self.state["completed_groups"] += 1
                    if group_id in self.state["current_groups"]:
                        self.state["current_groups"].remove(group_id)
                return (group_id, cached, True)
            members = self.qq_client.get_group_member_list(group_id)
            self.cache.append_group_members(group_id, members)
            with self._lock:
                self.state["results"][str(group_id)] = members
                self.state["completed_groups"] += 1
                if group_id in self.state["current_groups"]:
                    self.state["current_groups"].remove(group_id)
            return (group_id, members, False)
        except Exception as e:
            with self._lock:
                self.state["failed_groups"].append({
                    "group_id": group_id,
                    "group_name": group_name,
                    "error": str(e)
                })
                if group_id in self.state["current_groups"]:
                    self.state["current_groups"].remove(group_id)
            return (group_id, None, str(e))

    def start_loading(self, group_list, max_workers=None):
        if self.state["status"] == "loading":
            return False
        self._stop_event.clear()
        workers = max_workers or self.max_workers
        self.state = {
            "status": "loading",
            "total_groups": len(group_list),
            "completed_groups": 0,
            "failed_groups": [],
            "current_groups": [],
            "results": {},
            "group_list": group_list
        }
        self._executor = ThreadPoolExecutor(max_workers=workers)
        self._futures = []
        for group in group_list:
            if self._stop_event.is_set():
                break
            group_id = group.get("group_id")
            group_name = group.get("group_name", "")
            future = self._executor.submit(self._load_single_group, group_id, group_name)
            self._futures.append(future)
        def _wait_and_update():
            for _ in as_completed(self._futures):
                if self._stop_event.is_set():
                    break
            with self._lock:
                if not self._stop_event.is_set():
                    self.state["status"] = "completed"
                else:
                    self.state["status"] = "stopped"
            self._executor.shutdown(wait=False)
        wait_thread = threading.Thread(target=_wait_and_update, daemon=True)
        wait_thread.start()
        return True

    def stop_loading(self):
        self._stop_event.set()
        with self._lock:
            self.state["status"] = "stopped"
        if self._executor:
            self._executor.shutdown(wait=False)

    def get_progress(self):
        with self._lock:
            return {
                "status": self.state["status"],
                "total_groups": self.state["total_groups"],
                "completed_groups": self.state["completed_groups"],
                "failed_count": len(self.state["failed_groups"]),
                "failed_groups": self.state["failed_groups"],
                "current_groups": list(self.state["current_groups"]),
                "results": dict(self.state["results"]),
                "completed_group_ids": list(self.state["results"].keys())
            }

    def get_new_completed(self, last_completed_ids):
        with self._lock:
            new_ids = [gid for gid in self.state["results"].keys() if gid not in last_completed_ids]
            new_results = {gid: self.state["results"][gid] for gid in new_ids}
            return {
                "new_groups": new_results,
                "all_completed_ids": list(self.state["results"].keys()),
                "status": self.state["status"],
                "completed_count": self.state["completed_groups"],
                "total_count": self.state["total_groups"]
            }
