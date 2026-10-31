"""
Firestore 저장소 (docs/tonkatsu-integration.md의 데이터 구조).

- 공용 컬렉션(plans, checkIns, offDays, members, votes)은 Firestore 리스너로 메모리에 실시간 복사해 둡니다.
  앱에서 인증하면 봇 메모리에도 바로 반영되고, 자동완성처럼 빨라야 하는 곳은 메모리만 읽습니다.
- 쓰기는 항상 Firestore에 먼저 하고, 성공하면 메모리에도 바로 반영합니다. 나중에 리스너가 같은 내용을 다시 알려줘도 결과는 같습니다.
- 리스너 콜백은 별도 스레드에서 오므로, 메모리 변경은 모두 이벤트 루프 스레드에서만 합니다.
- 봇은 서비스 계정으로 접속해 보안 규칙을 거치지 않습니다. 그래서 앱이 나중에 수정할 수 있도록 규칙과 같은 형식으로 씁니다.
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

from google.api_core import exceptions as gexc
from google.cloud import firestore
from google.cloud.firestore_v1.watch import ChangeType

import core

MIRRORED = ("plans", "checkIns", "offDays", "members", "votes")
DEFAULT_PROJECT_ID = "planer-f8cb7"

# 앱 보안 규칙(validPlan)과 같은 필드만 저장 → 앱에서도 이름 변경·삭제 가능
PLAN_BASE_KEYS = ("ownerId", "category", "content", "photo", "startDate", "status", "createdAt", "updatedAt")
PLAN_EXTRA_KEYS = {
    "Daily": (), "Weekly": ("count",), "Monthly": ("count",), "Routine": ("days",),
    "Interval": ("interval",), "OneTime": ("deadline",), "Limit": ("period", "limit"),
}

def make_clients(project_id=None, credentials_path=None):
    """(동기 클라이언트, 비동기 클라이언트). FIRESTORE_EMULATOR_HOST가 있으면 에뮬레이터에 접속"""
    project_id = project_id or os.getenv("FIREBASE_PROJECT_ID") or DEFAULT_PROJECT_ID
    if os.getenv("FIRESTORE_EMULATOR_HOST"):
        return firestore.Client(project=project_id), firestore.AsyncClient(project=project_id)

    credentials_path = credentials_path or os.getenv("FIREBASE_CREDENTIALS")
    if not credentials_path:
        raise RuntimeError(".env 파일에 FIREBASE_CREDENTIALS(서비스 계정 키 파일 경로)가 없습니다.")
    if not os.path.isfile(credentials_path):
        raise RuntimeError(f"서비스 계정 키 파일을 찾을 수 없습니다: {credentials_path}")
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(credentials_path)
    return (firestore.Client(project=project_id, credentials=creds),
            firestore.AsyncClient(project=project_id, credentials=creds))

def _local_value(value):
    """메모리 사본에 넣을 값: 서버 시각 표시는 지금 시각으로 바꿈"""
    if value is firestore.SERVER_TIMESTAMP:
        return datetime.now(timezone.utc)
    return value

def _sort_time(value):
    return value.timestamp() if isinstance(value, datetime) else 0

class Store:
    def __init__(self, sync_client, async_client):
        self.sync = sync_client
        self.db = async_client
        self.data = {name: {} for name in MIRRORED}
        self._watches = {}
        self._loop = None
        self._version = 0
        self._views_cache = None

    # ---------- 실시간 복사 ----------

    async def start(self, timeout=60):
        """모든 공용 컬렉션의 첫 데이터가 들어올 때까지 기다림"""
        self._loop = asyncio.get_running_loop()
        ready = {name: asyncio.Event() for name in MIRRORED}
        for name in MIRRORED:
            self._watch(name, ready[name])
        await asyncio.wait_for(asyncio.gather(*(e.wait() for e in ready.values())), timeout)

    def _watch(self, name, ready_event=None):
        loop = self._loop

        def on_snapshot(_docs, changes, _read_time):
            payload = [(c.type, c.document.id, None if c.type == ChangeType.REMOVED else c.document.to_dict())
                       for c in changes]
            loop.call_soon_threadsafe(self._apply_snapshot, name, payload, ready_event)

        self._watches[name] = self.sync.collection(name).on_snapshot(on_snapshot)

    def _apply_snapshot(self, name, payload, ready_event):
        target = self.data[name]
        for change_type, doc_id, doc in payload:
            if change_type == ChangeType.REMOVED:
                target.pop(doc_id, None)
            else:
                target[doc_id] = doc
        self._changed()
        if ready_event is not None:
            ready_event.set()

    def ensure_watching(self):
        """리스너가 끊겼으면 다시 연결 (매시간 확인)"""
        restarted = []
        for name in MIRRORED:
            watch = self._watches.get(name)
            if watch is None or getattr(watch, "_closed", False):
                self._watch(name)
                restarted.append(name)
        return restarted

    def stop(self):
        for watch in self._watches.values():
            try:
                watch.unsubscribe()
            except Exception:
                pass
        self._watches.clear()

    def _changed(self):
        self._version += 1
        self._views_cache = None

    def _local_set(self, name, doc_id, data, merge=False):
        if name not in self.data:
            return
        values = {k: _local_value(v) for k, v in data.items()}
        if merge and doc_id in self.data[name]:
            current = dict(self.data[name][doc_id])
            for k, v in values.items():
                if v is firestore.DELETE_FIELD:
                    current.pop(k, None)
                elif isinstance(v, firestore.Increment):
                    current[k] = (current.get(k) or 0) + v.value
                else:
                    current[k] = v
            values = current
        else:
            values = {k: (v.value if isinstance(v, firestore.Increment) else v)
                      for k, v in values.items() if v is not firestore.DELETE_FIELD}
        self.data[name][doc_id] = values
        self._changed()

    def _local_delete(self, name, doc_id):
        if name in self.data and self.data[name].pop(doc_id, None) is not None:
            self._changed()

    # ---------- 유저 뷰 (core.py가 쓰는 형식) ----------

    def all_views(self):
        """{디스코드ID: 뷰}. 데이터가 바뀔 때까지 같은 결과를 재사용"""
        if self._views_cache is not None:
            return self._views_cache

        history = {}
        for checkin in self.data["checkIns"].values():
            plan_id, date = checkin.get("planId"), checkin.get("date")
            if plan_id and date:
                history.setdefault(plan_id, []).append(date)

        views = {}
        def view_of(owner):
            return views.setdefault(owner, {"completed_goals": [], "rest_history": [], "exemptions": [],
                                            "fines": 0, "alert_time": 2})

        for discord_id, member in self.data["members"].items():
            v = view_of(discord_id)
            v["fines"] = member.get("fines", 0) or 0
            v["alert_time"] = member.get("alertHour", 2)
            v["display_name"] = member.get("displayName") or discord_id

        plans = sorted(self.data["plans"].items(),
                       key=lambda kv: (kv[1].get("startDate", ""), _sort_time(kv[1].get("createdAt")), kv[0]))
        for plan_id, doc in plans:
            owner, category, status = doc.get("ownerId"), doc.get("category"), doc.get("status", "active")
            if not owner or category not in core.PLAN_CATEGORIES or "content" not in doc or status == "deleted":
                continue
            plan = dict(doc)
            plan.update(id=plan_id, history=sorted(history.get(plan_id, [])),
                        created_at=doc.get("startDate", "2000-01-01"),
                        completed=status == "completed", completed_at=doc.get("completedAt"))
            v = view_of(owner)
            if status == "completed":
                v["completed_goals"].append(plan)
            else:
                v.setdefault(category, []).append(plan)

        for off in self.data["offDays"].values():
            owner, date = off.get("ownerId"), off.get("date")
            if owner and date:
                view_of(owner)["rest_history" if off.get("type") == "rest" else "exemptions"].append(date)
        for v in views.values():
            v["rest_history"].sort()
            v["exemptions"].sort()

        self._views_cache = views
        return views

    def view(self, discord_id):
        return self.all_views().get(str(discord_id)) or {"completed_goals": [], "rest_history": [], "exemptions": [],
                                                          "fines": 0, "alert_time": 2}

    @staticmethod
    def find_plan(view, value):
        """자동완성 값(계획 ID) 또는 직접 입력한 이름으로 활성 계획 찾기"""
        for category, plan in core.iter_plans(view):
            if plan["id"] == value:
                return category, plan
        for category, plan in core.iter_plans(view):
            if plan["content"] == value:
                return category, plan
        return None, None

    # ---------- 멤버 ----------

    async def ensure_member(self, discord_id, display_name):
        """멤버 문서가 없으면 만들고, 표시 이름이 바뀌었으면 갱신"""
        discord_id = str(discord_id)
        current = self.data["members"].get(discord_id)
        if current is None:
            data = {"discordId": discord_id, "displayName": display_name, "uid": None, "alertHour": 2, "fines": 0,
                    "createdAt": firestore.SERVER_TIMESTAMP}
            ref = self.db.collection("members").document(discord_id)
            try:
                await ref.create(data)
                self._local_set("members", discord_id, data)
            except (gexc.AlreadyExists, gexc.Conflict):
                await ref.set({"displayName": display_name}, merge=True)
                self._local_set("members", discord_id, {"displayName": display_name}, merge=True)
        elif current.get("displayName") != display_name:
            await self.db.collection("members").document(discord_id).set({"displayName": display_name}, merge=True)
            self._local_set("members", discord_id, {"displayName": display_name}, merge=True)

    async def set_alert_hour(self, discord_id, hour):
        discord_id = str(discord_id)
        await self.db.collection("members").document(discord_id).set({"alertHour": hour}, merge=True)
        self._local_set("members", discord_id, {"alertHour": hour}, merge=True)

    async def set_server_info(self, guild_id, name, icon_url):
        await self.db.collection("server").document("info").set({
            "guildId": str(guild_id), "name": name, "iconUrl": icon_url, "updatedAt": firestore.SERVER_TIMESTAMP,
        })

    # ---------- 계획 ----------

    async def add_plan(self, owner_id, category, fields, start_date):
        """계획 등록. fields: content, photo + 카테고리별 필드. 새 계획 ID를 돌려줌"""
        data = {
            "ownerId": str(owner_id), "category": category, "content": fields["content"],
            "photo": bool(fields.get("photo", False)) and category != "Limit",
            "startDate": start_date, "status": "active",
            "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        for key in PLAN_EXTRA_KEYS[category]:
            data[key] = fields[key]
        ref = self.db.collection("plans").document()
        await ref.set(data)
        self._local_set("plans", ref.id, data)
        return ref.id

    async def delete_plan(self, plan_id):
        """실제로 지우지 않고 status를 deleted로 (과거 인증·벌금 기록 보존)"""
        change = {"status": "deleted", "updatedAt": firestore.SERVER_TIMESTAMP}
        await self.db.collection("plans").document(plan_id).update(change)
        self._local_set("plans", plan_id, change, merge=True)

    # ---------- 인증 ----------

    async def add_check_in(self, plan, date, owner_id):
        """
        인증 기록 추가. 제한 계획이 아니면 문서 ID를 {계획ID}_{날짜}로 고정해 하루 한 번만 남김.
        목표 계획이면 같은 요청에서 달성 처리. 인증 문서 ID를 돌려줌
        """
        is_limit = plan["category"] == "Limit"
        ref = (self.db.collection("checkIns").document() if is_limit
               else self.db.collection("checkIns").document(f"{plan['id']}_{date}"))
        data = {"planId": plan["id"], "ownerId": str(owner_id), "date": date, "source": "discord",
                "createdAt": firestore.SERVER_TIMESTAMP}

        batch = self.db.batch()
        batch.create(ref, data)
        goal_change = None
        if plan["category"] == "OneTime":
            goal_change = {"status": "completed", "completedAt": date, "updatedAt": firestore.SERVER_TIMESTAMP}
            batch.update(self.db.collection("plans").document(plan["id"]), goal_change)
        try:
            await batch.commit()
        except (gexc.AlreadyExists, gexc.Conflict):
            # 그날 이미 인증됨 (앱이나 다른 명령에서) → 성공으로 취급
            return ref.id
        self._local_set("checkIns", ref.id, data)
        if goal_change:
            self._local_set("plans", plan["id"], goal_change, merge=True)
        return ref.id

    async def set_check_in_message(self, check_in_id, message_url):
        """디스코드 인증 메시지 링크 (사진 검수용). 앱에서 누르면 메시지로 이동"""
        try:
            await self.db.collection("checkIns").document(check_in_id).update({"messageUrl": message_url})
            self._local_set("checkIns", check_in_id, {"messageUrl": message_url}, merge=True)
        except gexc.NotFound:
            pass

    async def cancel_check_in(self, plan, date):
        """그 날짜의 인증 한 번 취소 (가장 나중 기록). 달성한 목표면 다시 진행 중으로"""
        records = sorted(((cid, c) for cid, c in self.data["checkIns"].items()
                          if c.get("planId") == plan["id"] and c.get("date") == date),
                         key=lambda kv: _sort_time(kv[1].get("createdAt")))
        if not records:
            return False
        check_in_id = records[-1][0]
        batch = self.db.batch()
        batch.delete(self.db.collection("checkIns").document(check_in_id))
        goal_change = None
        if plan.get("status") == "completed" and plan.get("completedAt") == date:
            goal_change = {"status": "active", "completedAt": firestore.DELETE_FIELD, "updatedAt": firestore.SERVER_TIMESTAMP}
            batch.update(self.db.collection("plans").document(plan["id"]), goal_change)
        await batch.commit()
        self._local_delete("checkIns", check_in_id)
        if goal_change:
            self._local_set("plans", plan["id"], goal_change, merge=True)
        return True

    # ---------- 휴식·면책 ----------

    async def add_rest(self, owner_id, date):
        """휴식권 사용. 문서 ID {디스코드ID}_rest_{YYYY-MM}로 월 1회 (앱 규칙과 같음). 이미 있으면 False"""
        doc_id = f"{owner_id}_rest_{date[:7]}"
        data = {"ownerId": str(owner_id), "type": "rest", "date": date, "createdAt": firestore.SERVER_TIMESTAMP}
        try:
            await self.db.collection("offDays").document(doc_id).create(data)
        except (gexc.AlreadyExists, gexc.Conflict):
            return False
        self._local_set("offDays", doc_id, data)
        return True

    async def cancel_rest(self, owner_id, date):
        targets = [oid for oid, o in self.data["offDays"].items()
                   if o.get("ownerId") == str(owner_id) and o.get("type") == "rest" and o.get("date") == date]
        for oid in targets:
            await self.db.collection("offDays").document(oid).delete()
            self._local_delete("offDays", oid)
        return bool(targets)

    async def add_exemptions(self, owner_id, dates):
        batch = self.db.batch()
        items = []
        for date in dates:
            doc_id = f"{owner_id}_exempt_{date}"
            data = {"ownerId": str(owner_id), "type": "exempt", "date": date, "createdAt": firestore.SERVER_TIMESTAMP}
            batch.set(self.db.collection("offDays").document(doc_id), data)
            items.append((doc_id, data))
        await batch.commit()
        for doc_id, data in items:
            self._local_set("offDays", doc_id, data)

    # ---------- 벌금 ----------

    async def add_fine(self, owner_id, amount, reason, date, kind, event_id=None):
        """
        벌금 내역 1건 추가 + 멤버 누적 벌금 갱신 (한 번에).
        event_id가 같은 내역이 이미 있으면 아무것도 하지 않고 False (정산이 두 번 돌아도 안전)
        """
        owner_id = str(owner_id)
        event_id = event_id or f"{kind}_{uuid.uuid4().hex}"
        batch = self.db.batch()
        batch.create(self.db.collection("fineEvents").document(event_id), {
            "discordId": owner_id, "amount": amount, "reason": reason, "date": date, "kind": kind,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
        batch.set(self.db.collection("members").document(owner_id),
                  {"discordId": owner_id, "fines": firestore.Increment(amount)}, merge=True)
        try:
            await batch.commit()
        except (gexc.AlreadyExists, gexc.Conflict):
            return False
        self._local_set("members", owner_id, {"discordId": owner_id, "fines": firestore.Increment(amount)}, merge=True)
        return True

    # ---------- 면책 투표 ----------

    async def set_vote(self, message_id, data):
        await self.db.collection("votes").document(str(message_id)).set(data)
        self._local_set("votes", str(message_id), data)

    async def delete_vote(self, message_id):
        await self.db.collection("votes").document(str(message_id)).delete()
        self._local_delete("votes", str(message_id))

    # ---------- 계정 연동 ----------

    async def link_account(self, discord_id, code, max_age_seconds=600):
        """
        앱에서 만든 연동 코드로 디스코드 계정과 앱 계정(Firebase uid)을 연결.
        결과: ('linked', uid) / ('invalid', None) / ('expired', None)
        - 이 디스코드 계정이 다른 앱 계정과 연결돼 있었으면 그 연결은 끊고 새 계정으로 옮김
        - 이 앱 계정이 다른 디스코드 계정과 연결돼 있었으면 그 연결도 끊음
        """
        discord_id = str(discord_id)
        code_ref = self.db.collection("linkCodes").document(code)
        member_ref = self.db.collection("members").document(discord_id)
        transaction = self.db.transaction()

        @firestore.async_transactional
        async def run(tx):
            code_snap = await code_ref.get(transaction=tx)
            if not code_snap.exists:
                return "invalid", None, None
            data = code_snap.to_dict()
            uid, created = data.get("uid"), data.get("createdAt")
            if not isinstance(uid, str) or not isinstance(created, datetime) \
                    or (datetime.now(timezone.utc) - created).total_seconds() > max_age_seconds:
                tx.delete(code_ref)
                return "expired", None, None

            link_ref = self.db.collection("links").document(uid)
            link_snap = await link_ref.get(transaction=tx)
            member_snap = await member_ref.get(transaction=tx)
            old_uid = (member_snap.to_dict() or {}).get("uid") if member_snap.exists else None
            other_discord = (link_snap.to_dict() or {}).get("discordId") if link_snap.exists else None

            if old_uid and old_uid != uid:
                tx.delete(self.db.collection("links").document(old_uid))
            if other_discord and other_discord != discord_id:
                tx.set(self.db.collection("members").document(other_discord), {"uid": None}, merge=True)
            tx.set(link_ref, {"uid": uid, "discordId": discord_id, "linkedAt": firestore.SERVER_TIMESTAMP})
            tx.set(member_ref, {"discordId": discord_id, "uid": uid}, merge=True)
            tx.delete(code_ref)
            return "linked", uid, other_discord

        result, uid, other_discord = await run(transaction)
        if result == "linked":
            if other_discord and other_discord != discord_id:
                self._local_set("members", other_discord, {"uid": None}, merge=True)
            self._local_set("members", discord_id, {"discordId": discord_id, "uid": uid}, merge=True)
        return result, uid

    async def unlink_account(self, discord_id):
        """연동 해제. 연결된 앱 계정이 없었으면 False"""
        discord_id = str(discord_id)
        member = self.data["members"].get(discord_id) or {}
        snap = await self.db.collection("members").document(discord_id).get()
        uid = (snap.to_dict() or {}).get("uid") if snap.exists else member.get("uid")
        if not uid:
            return False
        batch = self.db.batch()
        batch.delete(self.db.collection("links").document(uid))
        batch.set(self.db.collection("members").document(discord_id), {"uid": None}, merge=True)
        await batch.commit()
        self._local_set("members", discord_id, {"uid": None}, merge=True)
        return True

    async def cleanup_link_codes(self, max_age_seconds=3600):
        """만든 지 오래된(쓰지 않은) 연동 코드 삭제"""
        now = datetime.now(timezone.utc)
        removed = 0
        async for snap in self.db.collection("linkCodes").stream():
            created = (snap.to_dict() or {}).get("createdAt")
            if not isinstance(created, datetime) or (now - created).total_seconds() > max_age_seconds:
                await snap.reference.delete()
                removed += 1
        return removed

    # ---------- 봇 상태·백업 ----------

    async def get_state(self):
        snap = await self.db.collection("botState").document("state").get()
        return snap.to_dict() if snap.exists else None

    async def save_state(self, state):
        await self.db.collection("botState").document("state").set(state)

    async def export_all(self):
        """백업용: 공용 데이터 전체를 JSON으로 저장할 수 있는 dict로"""
        def plain(value):
            if isinstance(value, datetime):
                return value.isoformat()
            if isinstance(value, dict):
                return {k: plain(v) for k, v in value.items()}
            if isinstance(value, list):
                return [plain(v) for v in value]
            return value
        result = {}
        for name in ("plans", "checkIns", "offDays", "members", "votes", "fineEvents", "botState", "server"):
            docs = {}
            async for snap in self.db.collection(name).stream():
                docs[snap.id] = plain(snap.to_dict())
            result[name] = docs
        return result
