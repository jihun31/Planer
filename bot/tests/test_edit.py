from google.cloud import firestore

import core
import main
from conftest import Choice, FakeChannel, FakeInteraction, FakeUser, until
from store import PLAN_BASE_KEYS, PLAN_EXTRA_KEYS, Store

ALICE = FakeUser(100000000000000001, "앨리스")
TODAY = core.day_str(core.get_base_date())

async def setup(store, monkeypatch):
    channel = FakeChannel()
    monkeypatch.setattr(main.bot, "get_channel", lambda _id: channel)
    main.install_store_hooks(store)
    await store.ensure_member(ALICE.id, ALICE.display_name)
    return channel

def pid(store, content):
    return Store.find_plan(store.view(ALICE.id), content)[1]["id"]

async def edit(store, plan, **kw):
    it = FakeInteraction(ALICE)
    await main.plan_edit.callback(it, plan, **kw)
    return it.text()

async def test_edit_from_discord(store, raw, monkeypatch):
    channel = await setup(store, monkeypatch)
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("week"), "코딩", 3, None, Choice(1))
    p = pid(store, "코딩")
    assert "수정했어요" in await edit(store, p, 사진인증=Choice(0), 횟수=2)
    doc = raw.collection("plans").document(p).get().to_dict()
    assert doc["photo"] is False and doc["count"] == 2
    assert set(doc) == set(PLAN_BASE_KEYS) | set(PLAN_EXTRA_KEYS["Weekly"])  # 앱 규칙과 같은 필드 유지
    assert channel.sent[-1][0] == "✏️ **앨리스**님이 **'코딩'** 계획을 바꿨어요 (디스코드): 주 3회 → 주 2회, 사진 필수 O → X"

    # 이름만 바꾸면 알림 없음
    n = len(channel.sent)
    assert "수정했어요" in await edit(store, p, 내용="코딩 공부")
    assert len(channel.sent) == n
    assert Store.find_plan(store.view(ALICE.id), p)[1]["content"] == "코딩 공부"

    # 해당 없는 항목, 범위 밖, 변경 없음
    assert "주간(1~7)" in await edit(store, p, 횟수=8)
    assert "요일 계획에서만" in await edit(store, p, 요일="월수")
    assert "바뀐 내용이 없어요" in await edit(store, p, 횟수=2)
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("week"), "몬스터", 2, Choice(1))
    assert "사진 인증을 쓰지 않아요" in await edit(store, pid(store, "몬스터"), 사진인증=Choice(1))
    assert "수정했어요" in await edit(store, pid(store, "몬스터"), 횟수=0)
    assert "이번 주 2회 이하 → 이번 주 0회 이하" in channel.sent[-1][0]
    assert "이미 있어요" in await edit(store, p, 내용="몬스터")

async def test_routine_interval_goal(store, raw, monkeypatch):
    await setup(store, monkeypatch)
    await main.plan_routine.callback(FakeInteraction(ALICE), "요가", "월수")
    await main.plan_interval.callback(FakeInteraction(ALICE), 3, "청소")
    await main.plan_deadline.callback(FakeInteraction(ALICE), "2026-12-01", "접수")
    await edit(store, pid(store, "요가"), 요일="금월")
    await edit(store, pid(store, "청소"), 간격=7)
    assert "**2026-01-20**" in await edit(store, pid(store, "접수"), 마감일="2026/12/05")
    await edit(store, pid(store, "접수"), 마감일="2026-12-05")
    docs = {d.to_dict()["content"]: d.to_dict() for d in raw.collection("plans").stream()}
    assert docs["요가"]["days"] == ["월", "금"] and docs["청소"]["interval"] == 7 and docs["접수"]["deadline"] == "2026-12-05"

async def test_app_edit_is_announced(store, raw, monkeypatch):
    channel = await setup(store, monkeypatch)
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("day"), "운동", None, None, Choice(1))
    p = pid(store, "운동")
    # 앱(다른 곳)에서 사진 필수 해제
    raw.collection("plans").document(p).update({"photo": False, "updatedAt": firestore.SERVER_TIMESTAMP})
    await until(lambda: any(m and "(앱)" in m for m, _ in channel.sent))
    assert channel.sent[-1][0] == "✏️ **앨리스**님이 **'운동'** 계획을 바꿨어요 (앱): 사진 필수 O → X"
    # 이름만 바꾸거나 인증(다른 컬렉션)하면 알림 없음
    n = len(channel.sent)
    raw.collection("plans").document(p).update({"content": "운동2", "updatedAt": firestore.SERVER_TIMESTAMP})
    await until(lambda: Store.find_plan(store.view(ALICE.id), p)[1]["content"] == "운동2")
    assert len(channel.sent) == n
