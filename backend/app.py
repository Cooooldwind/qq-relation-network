import os
import sys
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qq_client import QQClient
from cache import DataCache
from data_processor import RelationDataProcessor
from group_loader import GroupMemberLoader

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")

NAPCAT_API_URL = "http://127.0.0.1:5700"
NAPCAT_ACCESS_TOKEN = "SB2VStQDAlAS8WqU"

qq_client = QQClient(api_url=NAPCAT_API_URL, access_token=NAPCAT_ACCESS_TOKEN, rate_limit=0.3)
cache = DataCache(cache_dir=DATA_DIR)
processor = RelationDataProcessor()
group_loader = GroupMemberLoader(qq_client, cache, max_workers=3)

_last_completed_ids = set()


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(FRONTEND_DIR, path)


@app.route("/api/status")
def api_status():
    try:
        info = qq_client.get_login_info()
        return jsonify({
            "ok": True,
            "login_info": info
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/friends")
def api_friends():
    try:
        no_cache = request.args.get("no_cache", "false").lower() == "true"
        if not no_cache and cache.exists("friends"):
            friends = cache.load("friends")
        else:
            friends = qq_client.get_friend_list(no_cache=no_cache)
            cache.save("friends", friends)
        if processor.login_user:
            processor.add_friends(friends)
        return jsonify({
            "ok": True,
            "count": len(friends),
            "friends": friends
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/groups")
def api_groups():
    try:
        no_cache = request.args.get("no_cache", "false").lower() == "true"
        if not no_cache and cache.exists("groups"):
            groups = cache.load("groups")
        else:
            groups = qq_client.get_group_list(no_cache=no_cache)
            cache.save("groups", groups)
        processor.add_groups(groups)
        return jsonify({
            "ok": True,
            "count": len(groups),
            "groups": groups
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/group_members/<group_id>")
def api_group_members(group_id):
    try:
        no_cache = request.args.get("no_cache", "false").lower() == "true"
        if not no_cache:
            cached = cache.get_group_members(group_id)
            if cached:
                members = cached
            else:
                members = qq_client.get_group_member_list(group_id, no_cache=no_cache)
                cache.append_group_members(group_id, members)
        else:
            members = qq_client.get_group_member_list(group_id, no_cache=no_cache)
            cache.append_group_members(group_id, members)
        processor.add_group_members(group_id, members)
        return jsonify({
            "ok": True,
            "group_id": group_id,
            "count": len(members),
            "members": members
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/start_loading", methods=["POST"])
def api_start_loading():
    global _last_completed_ids
    try:
        data = request.get_json() or {}
        group_ids = data.get("group_ids")
        thread_count = data.get("thread_count", 3)
        if group_ids:
            all_groups = cache.load("groups", [])
            group_list = [g for g in all_groups if str(g.get("group_id")) in map(str, group_ids)]
        else:
            if cache.exists("groups"):
                group_list = cache.load("groups")
            else:
                group_list = qq_client.get_group_list()
                cache.save("groups", group_list)
        login_info = qq_client.get_login_info()
        processor.reset()
        processor.set_login_user(login_info["user_id"], login_info["nickname"])
        friends = cache.load("friends", [])
        if friends:
            processor.add_friends(friends)
        processor.add_groups(group_list)
        _last_completed_ids = set()
        success = group_loader.start_loading(group_list, max_workers=thread_count)
        return jsonify({
            "ok": success,
            "total_groups": len(group_list),
            "message": "Loading started" if success else "Already loading"
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/loading_progress")
def api_loading_progress():
    global _last_completed_ids
    try:
        progress = group_loader.get_new_completed(_last_completed_ids)
        incremental = {"new_nodes": [], "new_links": [], "updated_nodes": []}
        for gid, members in progress["new_groups"].items():
            delta = processor.add_group_members(gid, members)
            incremental["new_nodes"].extend(delta["new_nodes"])
            incremental["new_links"].extend(delta["new_links"])
            incremental["updated_nodes"].extend(delta["updated_nodes"])
            _last_completed_ids.add(str(gid))
        return jsonify({
            "ok": True,
            "status": progress["status"],
            "completed_count": progress["completed_count"],
            "total_count": progress["total_count"],
            "incremental": incremental,
            "total_nodes": len(processor.nodes),
            "total_links": len(processor.links),
            "all_completed_ids": list(_last_completed_ids)
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/stop_loading", methods=["POST"])
def api_stop_loading():
    try:
        group_loader.stop_loading()
        return jsonify({
            "ok": True,
            "message": "Loading stopped"
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/relation_data")
def api_relation_data():
    try:
        processor.reset()
        login_info = qq_client.get_login_info()
        processor.set_login_user(login_info["user_id"], login_info["nickname"])
        friends = cache.load("friends", [])
        if friends:
            processor.add_friends(friends)
        groups = cache.load("groups", [])
        if groups:
            processor.add_groups(groups)
        group_members_data = cache.load("group_members", {})
        for gid, members in group_members_data.items():
            processor.add_group_members(gid, members)
        data = processor.get_full_data()
        return jsonify({
            "ok": True,
            "data": data,
            "stats": {
                "node_count": len(data["nodes"]),
                "link_count": len(data["links"])
            }
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e)
        })


@app.route("/api/reset", methods=["POST"])
def api_reset():
    global _last_completed_ids
    processor.reset()
    _last_completed_ids = set()
    return jsonify({"ok": True})


if __name__ == "__main__":
    print("=" * 60)
    print("  QQ 关系网可视化工具")
    print("=" * 60)
    print(f"  前端地址: http://127.0.0.1:5000")
    print(f"  数据目录: {DATA_DIR}")
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=False)
