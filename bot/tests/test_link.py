from datetime import datetime, timedelta, timezone

from google.cloud import firestore

import main
from conftest import Choice, FakeGuild, FakeInteraction, FakeUser

ALICE, BOB = FakeUser(100000000000000001, "앨리스"), FakeUser(100000000000000002, "밥")
GUILD = FakeGuild([ALICE, BOB])
GUILD.name = "돈까스 스터디"

def make_code(raw, code, uid, age_minutes=0):
    created = firestore.SERVER_TIMESTAMP if age_minutes == 0 else datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
    raw.collection("linkCodes").document(code).set({"uid": uid, "createdAt": created})

async def run(user, **kw):
    it = FakeInteraction(user, GUILD)
    await main.link_app.callback(it, **kw)
    return it.text()

async def test_link_flow(store, raw):
    main.link_failures.clear()
    await store.ensure_member(ALICE.id, ALICE.display_name)
    assert "아직 연동 전" in await run(ALICE)

    make_code(raw, "ABCD2345", "uid-a")
    assert "연동됐어요" in await run(ALICE, 코드="abcd-2345")  # 소문자·하이픈 허용
    link = raw.collection("links").document("uid-a").get().to_dict()
    assert link["discordId"] == str(ALICE.id)
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["uid"] == "uid-a"
    assert not raw.collection("linkCodes").document("ABCD2345").get().exists
    assert "연동되어 있어요" in await run(ALICE)

    # 같은 코드 재사용 불가
    assert "찾을 수 없어요" in await run(BOB, 코드="ABCD2345")

    # 앨리스가 새 앱 계정으로 다시 연동 → 예전 연결은 끊김
    make_code(raw, "EFGH2345", "uid-a2")
    assert "연동됐어요" in await run(ALICE, 코드="EFGH2345")
    assert not raw.collection("links").document("uid-a").get().exists
    assert raw.collection("links").document("uid-a2").get().exists

    # 같은 앱 계정을 밥이 연동 → 앨리스 쪽 연결이 풀림 (앱 계정 하나 = 디스코드 하나)
    make_code(raw, "JKLM2345", "uid-a2")
    assert "연동됐어요" in await run(BOB, 코드="JKLM2345")
    assert raw.collection("links").document("uid-a2").get().to_dict()["discordId"] == str(BOB.id)
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["uid"] is None

    # 해제
    assert "해제했어요" in await run(BOB, 동작=Choice("unlink"))
    assert not raw.collection("links").document("uid-a2").get().exists
    assert raw.collection("members").document(str(BOB.id)).get().to_dict()["uid"] is None
    assert "연동된 Planer 앱 계정이 없어요" in await run(BOB, 동작=Choice("unlink"))

async def test_expired_and_rate_limit(store, raw):
    main.link_failures.clear()
    make_code(raw, "QLDC2345", "uid-x", age_minutes=11)
    assert "10분이 지난" in await run(ALICE, 코드="QLDC2345")
    assert not raw.collection("linkCodes").document("QLDC2345").get().exists  # 만료 코드는 지움
    assert not raw.collection("links").document("uid-x").get().exists

    for bad in ["NOPE2345", "short", "ABCD234I", "XXXX2345"]:
        assert "찾을 수 없어요" in await run(ALICE, 코드=bad)
    make_code(raw, "GQQD2345", "uid-y")
    assert "너무 많이 틀렸어요" in await run(ALICE, 코드="GQQD2345")
    assert raw.collection("linkCodes").document("GQQD2345").get().exists  # 시도조차 안 함
    assert "연동됐어요" in await run(BOB, 코드="GQQD2345")  # 다른 사람은 영향 없음

async def test_cleanup_old_codes(store, raw):
    make_code(raw, "AAAA2345", "u1", age_minutes=90)
    make_code(raw, "BBBB2345", "u2")
    assert await store.cleanup_link_codes() == 1
    assert [d.id for d in raw.collection("linkCodes").stream()] == ["BBBB2345"]
