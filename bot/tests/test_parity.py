"""
봇(core.py)과 앱(tonkatsuCore.mjs)의 계산 결과가 같은지 확인하는 기준 파일을 만듭니다.
- 이 테스트는 core.py로 계산한 결과가 tests/fixtures/tonkatsu-parity.json과 같은지 확인
- 앱 쪽 tests/tonkatsu-core.test.mjs는 같은 파일로 JS 계산을 확인
core.py 규칙을 바꿨다면: TONKATSU_REGEN=1 로 이 테스트를 실행해 파일을 다시 만들고, JS도 같이 고치세요.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

import core

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "tonkatsu-parity.json"

def plan(category, content, history=(), created="2026-10-01", **extra):
    return {"category": category, "content": content, "history": sorted(history), "created_at": created, **extra}

VIEW = {
    "Daily": [plan("Daily", "운동", ["2026-11-02", "2026-11-04"])],
    "Routine": [plan("Routine", "요가", ["2026-11-02"], days=["월", "수", "금"]), plan("Routine", "매일요가", [], days=[])],
    "Weekly": [plan("Weekly", "코딩", ["2026-11-02", "2026-11-03", "2026-11-09"], count=3),
               plan("Weekly", "수영", [], count=2)],
    "Monthly": [plan("Monthly", "등산", ["2026-10-30", "2026-11-01", "2026-11-15"], count=4)],
    "Interval": [plan("Interval", "청소", ["2026-10-28"], interval=3), plan("Interval", "빨래", [], interval=2)],
    "OneTime": [plan("OneTime", "접수", [], deadline="2026-11-05"), plan("OneTime", "달성", ["2026-11-01"], deadline="2026-11-03", completed=True)],
    "Limit": [plan("Limit", "몬스터", ["2026-11-02", "2026-11-02", "2026-11-04"], period="week", limit=2),
              plan("Limit", "커피", ["2026-11-04"], period="day", limit=1),
              plan("Limit", "담배", ["2026-10-31"], period="month", limit=0)],
    "completed_goals": [], "rest_history": ["2026-11-03"], "exemptions": ["2026-11-03", "2026-11-12"],
}
DATES = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
         "2026-11-08", "2026-11-09", "2026-11-30", "2026-12-01"]
# 하루 기준(5시) 경계 주변 시각들 (UTC ms)
TIMES = [int((datetime(2026, 11, 4, h, m, tzinfo=core.KST)).timestamp() * 1000)
         for h, m in [(0, 0), (4, 59), (5, 0), (12, 0), (23, 59)]] + \
        [int(datetime(2026, 12, 31, 20, 0, tzinfo=timezone.utc).timestamp() * 1000)]

def compute():
    results = []
    for date_str in DATES:
        date = datetime.strptime(date_str, "%Y-%m-%d")
        for category, p in core.iter_plans(VIEW):
            row = {"date": date_str, "content": p["content"],
                   "progress": list(core.plan_progress_line(VIEW, category, p, date)),
                   "tag": core.autocomplete_tag(VIEW, category, p, date)}
            if category == "Weekly":
                row["target"] = core.get_weekly_target(VIEW, p, date)
            if category == "Monthly":
                row["target"] = core.get_monthly_target(VIEW, p, date)
            results.append(row)
    base = [{"ms": ms, "date": core.day_str(core.get_base_date(datetime.fromtimestamp(ms / 1000, core.KST)))} for ms in TIMES]
    return {"view": VIEW, "results": results, "baseDates": base}

def test_parity_fixture_matches_core():
    data = compute()
    if os.getenv("TONKATSU_REGEN"):
        FIXTURE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if not FIXTURE.exists():
        pytest.fail("기준 파일이 없습니다. TONKATSU_REGEN=1 로 만드세요.")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == data, \
        "core.py 결과가 기준 파일과 다릅니다. 규칙을 바꿨다면 TONKATSU_REGEN=1 로 다시 만들고 tonkatsuCore.mjs도 맞춰주세요."
