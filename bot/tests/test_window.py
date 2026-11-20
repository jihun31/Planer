"""봇 메모리에는 최근 기간 기록만: checkIns·offDays 기간 제한, N일 계획의 오래된 마지막 인증, 지난 투표 정리"""
from datetime import datetime

from google.cloud import firestore

import core
from conftest import PROJECT, FakeUser, until
from store import Store, make_clients, window_start

ALICE = FakeUser(100000000000000001, "앨리스")
TODAY = core.day_str(core.get_base_date())

def test_window_start_covers_last_month():
    at = lambda *a: datetime(*a, tzinfo=core.KST)
    assert window_start(at(2026, 11, 9, 12)) == "2026-10-01"
    assert window_start(at(2026, 12, 1, 12)) == "2026-10-01"   # 1일 정산은 어제(11월 30일)가 속한 달 기준
    assert window_start(at(2027, 1, 1, 3)) == "2026-11-01"
    assert window_start(at(2027, 1, 2, 12)) == "2026-12-01"

def check_in(raw, plan_id, date):
    raw.collection("checkIns").document(f"{plan_id}_{date}").set(
        {"planId": plan_id, "ownerId": str(ALICE.id), "date": date, "source": "app", "createdAt": firestore.SERVER_TIMESTAMP})

async def test_only_recent_records_in_memory(store, raw):
    interval_id = await store.add_plan(ALICE.id, "Interval", {"content": "청소", "interval": 3}, "2020-01-01")
    daily_id = await store.add_plan(ALICE.id, "Daily", {"content": "운동"}, "2020-01-01")
    for date in ("2020-01-05", "2020-02-01"):
        check_in(raw, interval_id, date)
    check_in(raw, daily_id, "2020-02-01")
    check_in(raw, daily_id, TODAY)
    raw.collection("offDays").document(f"{ALICE.id}_rest_2020-02").set(
        {"ownerId": str(ALICE.id), "type": "rest", "date": "2020-02-03"})

    # 새로 시작한 봇: 기간 밖 기록은 메모리에 없음, N일 계획은 마지막 인증 날짜만 기억
    sync_client, async_client = make_clients(project_id=PROJECT)
    fresh = Store(sync_client, async_client)
    await fresh.start()
    try:
        assert {c["date"] for c in fresh.data["checkIns"].values()} == {TODAY}
        assert fresh.data["offDays"] == {}
        assert Store.find_plan(fresh.view(ALICE.id), interval_id)[1]["history"] == ["2020-02-01"]
        assert Store.find_plan(fresh.view(ALICE.id), daily_id)[1]["history"] == [TODAY]
        # 기간 안 기록은 계속 실시간으로 들어옴
        check_in(raw, interval_id, TODAY)
        await until(lambda: Store.find_plan(fresh.view(ALICE.id), interval_id)[1]["history"] == ["2020-02-01", TODAY])
    finally:
        fresh.stop()

async def test_window_moves_forward(store, raw):
    interval_id = await store.add_plan(ALICE.id, "Interval", {"content": "청소", "interval": 3}, "2020-01-01")
    plan = Store.find_plan(store.view(ALICE.id), interval_id)[1]
    await store.add_check_in(plan, TODAY, ALICE.id)

    # 한참 뒤: 오늘 기록은 기간 밖으로 빠지지만 N일 계획의 마지막 인증 날짜로 남음
    restarted = store.refresh_window(datetime(2030, 6, 15, 12, tzinfo=core.KST))
    assert set(restarted) == {"checkIns", "offDays"}
    assert store.data["checkIns"] == {}
    assert Store.find_plan(store.view(ALICE.id), interval_id)[1]["history"] == [TODAY]
    # 다시 연 리스너는 새 기간 기록만 받음
    check_in(raw, interval_id, "2030-06-15")
    await until(lambda: [c["date"] for c in store.data["checkIns"].values()] == ["2030-06-15"])
    assert Store.find_plan(store.view(ALICE.id), interval_id)[1]["history"] == [TODAY, "2030-06-15"]
    assert store.refresh_window(datetime(2030, 6, 20, 12, tzinfo=core.KST)) == []   # 같은 기간이면 그대로

async def test_old_exemptions_and_votes(store, raw):
    await store.add_exemptions(ALICE.id, ["2020-01-01", TODAY])
    assert raw.collection("offDays").document(f"{ALICE.id}_exempt_2020-01-01").get().exists
    assert store.view(ALICE.id)["exemptions"] == [TODAY]

    await store.set_vote(1, {"target_id": ALICE.id, "target_dates": ["2020-01-01", "2020-01-02"]})
    await store.set_vote(2, {"target_id": ALICE.id, "target_dates": [TODAY]})
    await store.set_vote(3, {"target_id": ALICE.id})   # 날짜 없는 예전 형식은 건드리지 않음
    assert await store.expire_votes() == ["1"]
    assert not raw.collection("votes").document("1").get().exists
    assert set(store.data["votes"]) == {"2", "3"}
