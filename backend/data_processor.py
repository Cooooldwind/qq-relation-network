class RelationDataProcessor:
    def __init__(self):
        self.nodes = {}
        self.links = {}
        self.login_user = None
        self.friend_ids = set()
        self.user_group_map = {}

    def _link_key(self, source, target):
        s = str(source)
        t = str(target)
        return f"{min(s, t)}-{max(s, t)}"

    def _get_category(self, node_type):
        category_map = {
            "self": 0,
            "friend": 1,
            "acquaintance": 2,
            "stranger": 3,
            "group": 4
        }
        return category_map.get(node_type, 1)

    def _add_node(self, node_id, name, node_type, info=None):
        node_id = str(node_id)
        if node_id not in self.nodes:
            self.nodes[node_id] = {
                "id": str(node_id),
                "name": name,
                "type": node_type,
                "category": self._get_category(node_type),
                "value": 0,
                "symbolSize": 10,
                "info": info or {}
            }
        else:
            if info:
                self.nodes[node_id]["info"].update(info)
            if name and self.nodes[node_id]["name"] == str(node_id):
                self.nodes[node_id]["name"] = name
        return self.nodes[node_id]

    def _update_node_type(self, node_id, new_type):
        node_id = str(node_id)
        if node_id in self.nodes:
            self.nodes[node_id]["type"] = new_type
            self.nodes[node_id]["category"] = self._get_category(new_type)

    def _add_link(self, source, target, link_type):
        source = str(source)
        target = str(target)
        key = self._link_key(source, target)
        if key not in self.links:
            color_map = {"friend": "#4A90D9", "group": "#E74C3C"}
            self.links[key] = {
                "source": source,
                "target": target,
                "type": link_type,
                "lineStyle": {
                    "color": color_map.get(link_type, "#999"),
                    "width": 1,
                    "opacity": 0.4
                }
            }
            if source in self.nodes:
                self.nodes[source]["value"] += 1
                self._update_symbol_size(source)
            if target in self.nodes:
                self.nodes[target]["value"] += 1
                self._update_symbol_size(target)
        return self.links[key]

    def _update_symbol_size(self, node_id):
        if node_id in self.nodes:
            value = self.nodes[node_id]["value"]
            size = min(max(10, value * 2 + 8), 60)
            self.nodes[node_id]["symbolSize"] = size

    def set_login_user(self, user_id, nickname):
        self.login_user = str(user_id)
        self._add_node(user_id, nickname, "self", {"qq": user_id})

    def add_friends(self, friends):
        new_nodes = []
        new_links = []
        updated_nodes = []
        if not self.login_user:
            return {"new_nodes": new_nodes, "new_links": new_links, "updated_nodes": []}
        for friend in friends:
            user_id = str(friend.get("user_id"))
            if user_id == self.login_user:
                continue
            nickname = friend.get("nickname", user_id)
            remark = friend.get("remark", "")
            info = {"qq": user_id, "remark": remark}
            self.friend_ids.add(user_id)
            existed = user_id in self.nodes
            node = self._add_node(user_id, nickname, "friend", info)
            if existed and node["type"] != "friend":
                self._update_node_type(user_id, "friend")
                updated_nodes.append(node)
            if not existed:
                new_nodes.append(node)
            link_existed = self._link_key(self.login_user, user_id) in self.links
            link = self._add_link(self.login_user, user_id, "friend")
            if not link_existed:
                new_links.append(link)
        return {
            "new_nodes": new_nodes,
            "new_links": new_links,
            "updated_nodes": updated_nodes,
            "total_nodes": len(self.nodes),
            "total_links": len(self.links)
        }

    def add_groups(self, groups):
        new_nodes = []
        new_links = []
        for group in groups:
            group_id = str(group.get("group_id"))
            group_name = group.get("group_name", group_id)
            member_count = group.get("member_count", 0)
            info = {"group_id": group_id, "member_count": member_count}
            existed = group_id in self.nodes
            node = self._add_node(group_id, group_name, "group", info)
            if not existed:
                new_nodes.append(node)
            if self.login_user:
                if self.login_user not in self.user_group_map:
                    self.user_group_map[self.login_user] = set()
                self.user_group_map[self.login_user].add(group_id)
                link_existed = self._link_key(self.login_user, group_id) in self.links
                link = self._add_link(self.login_user, group_id, "group")
                if not link_existed:
                    new_links.append(link)
        return {
            "new_nodes": new_nodes,
            "new_links": new_links,
            "updated_nodes": [],
            "total_nodes": len(self.nodes),
            "total_links": len(self.links)
        }

    def add_group_members(self, group_id, members):
        new_nodes = []
        new_links = []
        updated_nodes = []
        group_id = str(group_id)
        if group_id not in self.nodes:
            return {"new_nodes": [], "new_links": [], "updated_nodes": []}
        group_node = self.nodes[group_id]
        old_value = group_node["value"]
        for member in members:
            user_id = str(member.get("user_id"))
            if user_id == self.login_user:
                if group_id not in self.user_group_map.setdefault(user_id, set()):
                    self.user_group_map[user_id].add(group_id)
                link_existed = self._link_key(group_id, user_id) in self.links
                link = self._add_link(group_id, user_id, "group")
                if not link_existed:
                    new_links.append(link)
                continue
            nickname = member.get("nickname", user_id)
            card = member.get("card", "")
            role = member.get("role", "member")
            info = {"qq": user_id, "card": card, "role": role}
            if user_id not in self.user_group_map:
                self.user_group_map[user_id] = set()
            self.user_group_map[user_id].add(group_id)
            group_count = len(self.user_group_map[user_id])
            existed = user_id in self.nodes
            is_friend = user_id in self.friend_ids
            if not existed:
                if is_friend:
                    node_type = "friend"
                elif group_count >= 2:
                    node_type = "acquaintance"
                else:
                    node_type = "stranger"
                node = self._add_node(user_id, nickname, node_type, info)
                node["info"]["common_group_count"] = group_count
                new_nodes.append(node)
            else:
                current_type = self.nodes[user_id]["type"]
                if card and "card" not in self.nodes[user_id].get("info", {}):
                    self.nodes[user_id]["info"]["card"] = card
                self.nodes[user_id]["info"]["common_group_count"] = group_count
                if not is_friend and current_type != "friend":
                    if group_count >= 2 and current_type != "acquaintance":
                        self._update_node_type(user_id, "acquaintance")
                        updated_nodes.append(self.nodes[user_id])
                    elif group_count == 1 and current_type == "stranger":
                        updated_nodes.append(self.nodes[user_id])
                elif is_friend and current_type != "friend":
                    self._update_node_type(user_id, "friend")
                    updated_nodes.append(self.nodes[user_id])
                else:
                    updated_nodes.append(self.nodes[user_id])
            link_existed = self._link_key(group_id, user_id) in self.links
            link = self._add_link(group_id, user_id, "group")
            if not link_existed:
                new_links.append(link)
        if group_id in self.nodes and self.nodes[group_id]["value"] != old_value:
            if group_node not in updated_nodes:
                updated_nodes.append(group_node)
        return {
            "new_nodes": new_nodes,
            "new_links": new_links,
            "updated_nodes": updated_nodes,
            "total_nodes": len(self.nodes),
            "total_links": len(self.links)
        }

    def get_full_data(self):
        return {
            "nodes": list(self.nodes.values()),
            "links": list(self.links.values()),
            "categories": [
                {"name": "自己", "itemStyle": {"color": "#FFD700"}},
                {"name": "好友", "itemStyle": {"color": "#4A90D9"}},
                {"name": "共同群好友", "itemStyle": {"color": "#87CEEB"}},
                {"name": "仅同群", "itemStyle": {"color": "#B0C4DE"}},
                {"name": "群", "itemStyle": {"color": "#E74C3C"}}
            ]
        }

    def reset(self):
        self.nodes = {}
        self.links = {}
        self.login_user = None
        self.friend_ids = set()
        self.user_group_map = {}
