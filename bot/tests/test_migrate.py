from datetime import datetime

import core
from conftest import until
from tools import migrate_json_to_firestore as mig

A, B = "100000000000000001", "100000000000000002"
PLANS = {
    A: {
        "Daily": [{"content": "운동", "history": ["2026-11-01", "2026-11-02"], "created_at": "2026-10-01", "photo": True}, "옛날 문자열 계획"],
        "Weekly": [{"content": "코딩", "count": 9, "history": ["2026-11-03"]}],
        "Limit": [{"content": "몬스터", "period": "week", "limit": 2, "history": ["2026-11-03", "2026-11-03", "2026-11-04"]}],
        "Routine": [{"content": "요가", "days": ["월", "수"], "history": []}],
        "OneTime": [{"content": "옛 달성", "deadline": "2026-10-20", "completed": True, "history": ["2026-10-19"]},
                    {"content": "마감 이상", "deadline": "2026/10/20"}],
        "completed_goals": [{"content": "접수", "deadline": "2026-11-20", "completed": True, "completed_at": "2026-11-02", "history": ["2026-11-02"]}],
        "rest_history": ["2026-11-05", "2026-11-12"],
        "exemptions": ["2026-11-06", "2", "2026-11-06"],
        "fines": 9000, "alert_time": 23,
    },
    B: {"Daily": [{"content": "독서", "history": []}]},
    "system_data": {},
}
VOTES = {"4242": {"target_id": int(A), "target_dates": ["2026-11-10"], "agreed_users": [], "denied_users": [],
                  "total_members": 2, "required_votes": 1, "eligible_voters": [int(B)]}}
STATE = {"last_settlement_date": "2026-11-09", "last_backup_date": "2026-11-09", "extra": 1}

def counts(raw):
    return {name: len(list(raw.collection(name).stream()))
            for name in ("plans", "checkIns", "offDays", "members", "fineEvents", "votes", "botState")}

async def test_migration_is_complete_and_idempotent(store, raw):
    writes, warnings = mig.convert(PLANS, VOTES, STATE)
    assert any("마감일이 이상한" in w for w in warnings) and any("면책 날짜" in w for w in warnings)
    mig.apply(raw, writes)
    first = counts(raw)
    assert first == {"plans": 7, "checkIns": 8, "offDays": 3, "members": 2, "fineEvents": 1, "votes": 1, "botState": 1}

    # 연동 후 다시 실행해도 uid·이름은 유지되고 개수는 그대로
    raw.collection("members").document(A).update({"uid": "linked-uid", "displayName": "앨리스"})
    mig.apply(raw, mig.convert(PLANS, VOTES, STATE)[0])
    assert counts(raw) == first
    member = raw.collection("members").document(A).get().to_dict()
    assert member["uid"] == "linked-uid" and member["displayName"] == "앨리스" and member["fines"] == 9000 and member["alertHour"] == 23

    await until(lambda: len(store.data["plans"]) == 7 and len(store.data["checkIns"]) == 8)
    view = store.view(A)
    names = {c: [p["content"] for p in view.get(c, [])] for c in core.PLAN_CATEGORIES}
    assert names["Daily"] == ["운동"] and names["OneTime"] == [] and names["Routine"] == ["요가"]
    assert sorted(g["content"] for g in view["completed_goals"]) == ["옛 달성", "접수"]
    daily = view["Daily"][0]
    assert daily["history"] == ["2026-11-01", "2026-11-02"] and daily["created_at"] == "2026-10-01" and daily["photo"]
    weekly = view["Weekly"][0]
    assert weekly["count"] == 7 and weekly["created_at"] == mig.OLD_DATE  # 범위 맞춤, 예전 계획은 등록일 없음
    limit = view["Limit"][0]
    assert limit["history"].count("2026-11-03") == 2 and len(limit["history"]) == 3
    assert view["rest_history"] == ["2026-11-05", "2026-11-12"] and view["exemptions"] == ["2026-11-06"]
    assert view["fines"] == 9000 and view["alert_time"] == 23
    assert raw.collection("offDays").document(f"{A}_rest_2026-11").get().exists  # 앱 규칙과 같은 ID
    assert raw.collection("botState").document("state").get().to_dict() == {"last_settlement_date": "2026-11-09", "last_backup_date": "2026-11-09"}
    assert "4242" in store.data["votes"]

    # 옮긴 데이터로도 정산이 동작: 11/9 일일 계획 미인증 → 벌금
    fined, kind, details = core.settle_user(view, datetime(2026, 11, 10, 12, tzinfo=core.KST))
    assert fined and any("[일일]운동" in d for d in details)

def test_dry_run_writes_nothing(tmp_path, capsys):
    import json
    (tmp_path / "study_plans.json").write_text(json.dumps(PLANS, ensure_ascii=False), encoding="utf-8")
    assert mig.main(["--data-dir", str(tmp_path), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "plans 7개" in out and "--dry-run" in out
