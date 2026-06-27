import time
import random
import requests


class QQClient:
    def __init__(self, api_url="http://127.0.0.1:5700", access_token=None, rate_limit=0.5):
        self.api_url = api_url.rstrip("/")
        self.access_token = access_token
        self.rate_limit = rate_limit
        self._last_request_time = 0

    def _wait_rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed + random.uniform(0, 0.3))
        self._last_request_time = time.time()

    def _get_headers(self):
        headers = {}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        return headers

    def _request(self, endpoint, params=None):
        self._wait_rate_limit()
        url = f"{self.api_url}/{endpoint}"
        try:
            resp = requests.get(url, params=params, headers=self._get_headers(), timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if data.get("retcode") == 0:
                return data.get("data")
            else:
                raise Exception(f"API Error: {data.get('msg', data.get('message', 'Unknown error'))}")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Request failed: {str(e)}")

    def get_login_info(self):
        return self._request("get_login_info")

    def get_friend_list(self, no_cache=False):
        params = {"no_cache": no_cache} if no_cache else None
        return self._request("get_friend_list", params)

    def get_group_list(self, no_cache=False):
        params = {"no_cache": no_cache} if no_cache else None
        return self._request("get_group_list", params)

    def get_group_info(self, group_id, no_cache=False):
        params = {"group_id": group_id}
        if no_cache:
            params["no_cache"] = True
        return self._request("get_group_info", params)

    def get_group_member_list(self, group_id, no_cache=False):
        params = {"group_id": group_id}
        if no_cache:
            params["no_cache"] = True
        return self._request("get_group_member_list", params)

    def get_stranger_info(self, user_id, no_cache=False):
        params = {"user_id": user_id}
        if no_cache:
            params["no_cache"] = True
        return self._request("get_stranger_info", params)
