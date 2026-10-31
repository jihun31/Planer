"""
기존 JSON 데이터를 Firestore로 옮기는 스크립트 (한 번 실행).

사용법 (봇을 끈 상태에서):
  python tools/migrate_json_to_firestore.py --data-dir ~/TonkatsuBot --dry-run   # 옮길 개수만 확인
  python tools/migrate_json_to_firestore.py --data-dir ~/TonkatsuBot             # 실제로 옮기기

- 문서 ID를 고정 규칙으로 만들기 때문에 여러 번 실행해도 중복되지 않습니다.
- JSON 파일은 읽기만 하고 바꾸지 않습니다.
- 접속 정보는 bot/.env의 FIREBASE_CREDENTIALS(서비스 계정 키 경로)를 씁니다.
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
from google.cloud import firestore  # noqa: E402

import core  # noqa: E402
from store import PLAN_EXTRA_KEYS, make_clients  # noqa: E402

OLD_DATE = "2000-01-01"  # 예전 계획(등록일 없음)은 지금처럼 모든 날짜를 검사

def valid_day(value):
    try:
        return isinstance(value, str) and datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d") == value
    except ValueError:
        return False

def plan_id(owner, category, content):
    digest = hashlib.sha1(f"{owner}|{category}|{content}".encode("utf-8")).hexdigest()[:20]
    return f"mig_{digest}"

def clamp(value, low, high, default):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default

def convert(plans_json, votes_json, state_json):
    """JSON → [(컬렉션, 문서 ID, 데이터, merge)] 목록과 경고 목록"""
    writes, warnings = [], []

    for owner, data in plans_json.items():
        if not str(owner).isdigit() or not isinstance(data, dict):
            warnings.append(f"건너뜀: 디스코드 ID가 아닌 항목 {owner!r}")
            continue
        owner = str(owner)

        # 활성 계획 + 달성한 목표
        entries = [(category, plan, False) for category in core.PLAN_CATEGORIES
                   for plan in (data.get(category) or []) if isinstance(plan, dict) and plan.get("content")]
        entries += [("OneTime", goal, True) for goal in (data.get("completed_goals") or [])
                    if isinstance(goal, dict) and goal.get("content")]
        for category, plan, from_completed_list in entries:
            content = str(plan["content"]).strip()
            if len(content) > 80:
                warnings.append(f"이름이 80자를 넘어 잘림: {owner} {content[:20]}…")
                content = content[:80]
            doc = {
                "ownerId": owner, "category": category, "content": content,
                "photo": bool(plan.get("photo")) and category != "Limit",
                "startDate": plan.get("created_at") if valid_day(plan.get("created_at")) else OLD_DATE,
                "status": "active", "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
            }
            if category in ("Weekly", "Monthly"):
                doc["count"] = clamp(plan.get("count"), 1, 7 if category == "Weekly" else 31, 1)
            elif category == "Routine":
                days = [d for d in core.WEEKDAY_NAMES if d in (plan.get("days") or [])]
                if not days:
                    warnings.append(f"요일이 없는 요일 계획 → 매일로 설정: {owner} {content}")
                    days = list(core.WEEKDAY_NAMES)
                doc["days"] = days
            elif category == "Interval":
                doc["interval"] = clamp(plan.get("interval"), 1, 365, 1)
            elif category == "OneTime":
                if not valid_day(plan.get("deadline")):
                    warnings.append(f"마감일이 이상한 목표 건너뜀: {owner} {content}")
                    continue
                doc["deadline"] = plan["deadline"]
            elif category == "Limit":
                doc["period"] = plan.get("period") if plan.get("period") in ("day", "week", "month") else "week"
                doc["limit"] = clamp(plan.get("limit"), 0, 50, 0)
            assert set(doc) - {"ownerId", "category", "content", "photo", "startDate", "status", "createdAt", "updatedAt"} \
                <= set(PLAN_EXTRA_KEYS[category])

            history = [d for d in (plan.get("history") or []) if valid_day(d)]
            if not history and valid_day(plan.get("last_verified")):
                history = [plan["last_verified"]]  # 아주 예전 데이터

            done = category == "OneTime" and (from_completed_list or bool(plan.get("completed")))
            if done:
                completed_at = next((d for d in (plan.get("completed_at"), *reversed(history)) if valid_day(d)), doc["deadline"])
                doc["status"], doc["completedAt"] = "completed", completed_at
                if completed_at not in history:
                    history.append(completed_at)

            pid = plan_id(owner, category, content)
            writes.append(("plans", pid, doc, False))

            if category == "Limit":
                counts = {}
                for date in history:
                    counts[date] = counts.get(date, 0) + 1
                    writes.append(("checkIns", f"{pid}_m{date}_{counts[date]}", check_in(pid, owner, date), False))
            else:
                for date in sorted(set(history)):
                    writes.append(("checkIns", f"{pid}_{date}", check_in(pid, owner, date), False))

        # 휴식: 한 달 첫 휴식은 앱 규칙과 같은 ID, 같은 달에 더 있으면(관리자 부여 등) 날짜 ID
        months = set()
        for date in sorted(d for d in (data.get("rest_history") or []) if valid_day(d)):
            doc_id = f"{owner}_rest_{date[:7]}" if date[:7] not in months else f"{owner}_rest_{date}"
            months.add(date[:7])
            writes.append(("offDays", doc_id, off_day(owner, "rest", date), False))
        bad = [d for d in (data.get("exemptions") or []) if not valid_day(d)]
        if bad:
            warnings.append(f"이상한 면책 날짜 {len(bad)}개 건너뜀: {owner}")
        for date in sorted({d for d in (data.get("exemptions") or []) if valid_day(d)}):
            writes.append(("offDays", f"{owner}_exempt_{date}", off_day(owner, "exempt", date), False))

        fines = data.get("fines", 0) or 0
        member = {"discordId": owner, "fines": fines, "alertHour": clamp(data.get("alert_time"), 0, 23, 2)}
        writes.append(("members", owner, member, True))
        if fines:
            writes.append(("fineEvents", f"migrated_{owner}", {
                "discordId": owner, "amount": fines, "reason": "이전 누적 벌금 (JSON에서 옮김)",
                "date": core.day_str(core.get_base_date()), "kind": "migrated", "createdAt": firestore.SERVER_TIMESTAMP,
            }, False))

    for message_id, vote in (votes_json or {}).items():
        if str(message_id).isdigit() and isinstance(vote, dict):
            writes.append(("votes", str(message_id), vote, False))

    if isinstance(state_json, dict):
        state = {k: v for k, v in state_json.items() if k in ("last_settlement_date", "last_backup_date")}
        if state:
            writes.append(("botState", "state", state, True))
    return writes, warnings

def check_in(pid, owner, date):
    return {"planId": pid, "ownerId": owner, "date": date, "source": "discord", "createdAt": firestore.SERVER_TIMESTAMP}

def off_day(owner, kind, date):
    return {"ownerId": owner, "type": kind, "date": date, "createdAt": firestore.SERVER_TIMESTAMP}

def read_json(path):
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def apply(client, writes):
    existing_members = {snap.id: snap.to_dict() for snap in client.collection("members").stream()}
    batch, count = client.batch(), 0
    for name, doc_id, data, merge in writes:
        ref = client.collection(name).document(doc_id)
        if name == "members":
            if doc_id not in existing_members:
                data = {**data, "uid": None, "displayName": doc_id, "createdAt": firestore.SERVER_TIMESTAMP}
            batch.set(ref, data, merge=True)  # 이미 연동된 uid, 표시 이름은 그대로
        else:
            batch.set(ref, data, merge=merge)
        count += 1
        if count % 400 == 0:
            batch.commit()
            batch = client.batch()
    batch.commit()

def main(argv=None):
    parser = argparse.ArgumentParser(description="돈까스봇 JSON 데이터를 Firestore로 옮깁니다.")
    parser.add_argument("--data-dir", required=True, help="study_plans.json 등이 있는 기존 봇 폴더")
    parser.add_argument("--dry-run", action="store_true", help="옮길 개수만 출력하고 쓰지 않음")
    args = parser.parse_args(argv)

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    data_dir = Path(args.data_dir).expanduser()
    plans_json = read_json(data_dir / "study_plans.json")
    if not plans_json:
        print(f"❌ {data_dir / 'study_plans.json'} 파일이 없거나 비어 있습니다.")
        return 1

    writes, warnings = convert(plans_json, read_json(data_dir / "active_votes.json"), read_json(data_dir / "bot_state.json"))
    summary = {}
    for name, *_ in writes:
        summary[name] = summary.get(name, 0) + 1
    print("옮길 문서 수:", ", ".join(f"{k} {v}개" for k, v in sorted(summary.items())))
    for w in warnings:
        print("⚠️", w)
    if args.dry_run:
        print("(--dry-run: 아무것도 쓰지 않았습니다)")
        return 0

    sync_client, _ = make_clients()
    apply(sync_client, writes)
    print(f"✅ 완료: {len(writes)}개 문서를 저장했습니다.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
