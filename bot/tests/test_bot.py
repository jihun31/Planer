from datetime import datetime, timedelta

import core
import main
from conftest import Attachment, Choice, FakeChannel, FakeGuild, FakeInteraction, FakeUser, until
from store import PLAN_BASE_KEYS, PLAN_EXTRA_KEYS, Store

ALICE, BOB, CAROL = FakeUser(100000000000000001, "앨리스"), FakeUser(100000000000000002, "밥"), FakeUser(100000000000000003, "캐럴")
TODAY = core.day_str(core.get_base_date())
YESTERDAY = core.day_str(core.get_base_date() - timedelta(days=1))

def plan_id(s, owner, content):
    return Store.find_plan(s.view(owner.id), content)[1]["id"]

def test_day_boundary_is_5am():
    at = lambda h, m: datetime(2026, 11, 4, h, m, tzinfo=core.KST)
    assert core.day_str(core.get_base_date(at(4, 59))) == "2026-11-03"
    assert core.day_str(core.get_base_date(at(5, 0))) == "2026-11-04"
    assert core.is_dawn(at(4, 0)) and not core.is_dawn(at(5, 0))

async def test_register_verify_and_app_compatible_fields(store, raw):
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("week"), "코딩", 3)
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("day"), "몬스터", 2, Choice(1))
    it = FakeInteraction(ALICE)
    await main.plan_register.callback(it, Choice("day"), "코딩")
    assert "이미" in it.text()

    # 저장된 문서가 앱 보안 규칙과 같은 필드만 가짐 → 앱에서도 수정 가능
    docs = {d.id: d.to_dict() for d in raw.collection("plans").stream()}
    assert len(docs) == 2
    for doc in docs.values():
        assert set(doc) == set(PLAN_BASE_KEYS) | set(PLAN_EXTRA_KEYS[doc["category"]])
        assert doc["startDate"] == TODAY and doc["status"] == "active" and doc["ownerId"] == str(ALICE.id)

    # 자동완성 값은 계획 ID
    choices = await main.plan_autocomplete(FakeInteraction(ALICE), "")
    coding = plan_id(store, ALICE, "코딩")
    assert coding in [c.value for c in choices]

    it = FakeInteraction(ALICE)
    await main.verify_study.callback(it, coding)
    snap = raw.collection("checkIns").document(f"{coding}_{TODAY}").get()
    assert snap.exists and snap.to_dict()["source"] == "discord"
    assert snap.to_dict()["messageUrl"].startswith("https://discord.com/channels/")
    assert "[1/3회]" in it.fields()["📅 현재 진행 상황"]
    # 같은 날 다시 인증해도 기록은 하나
    await main.verify_study.callback(FakeInteraction(ALICE), coding)
    assert len([d for d in raw.collection("checkIns").stream() if d.to_dict()["planId"] == coding]) == 1

async def test_photo_required_and_yesterday(store):
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("day"), "운동", None, None, Choice(1))
    pid = plan_id(store, ALICE, "운동")
    it = FakeInteraction(ALICE)
    await main.verify_study.callback(it, pid)
    assert "사진" in it.text()
    # 어제 날짜는 등록일 이전이라 거부
    it = FakeInteraction(ALICE)
    await main.verify_study.callback(it, pid, None, Attachment(), Choice("yesterday"))
    assert "등록한 계획" in it.text()
    await main.verify_study.callback(FakeInteraction(ALICE), pid, None, Attachment())
    assert Store.find_plan(store.view(ALICE.id), pid)[1]["history"] == [TODAY]

async def test_limit_multiple_and_cancel_one(store, raw):
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("week"), "몬스터", 2, Choice(1))
    pid = plan_id(store, ALICE, "몬스터")
    for _ in range(3):
        it = FakeInteraction(ALICE)
        await main.verify_study.callback(it, pid)
    assert "🚨 제한 초과!" in it.fields()
    it = FakeInteraction(ALICE)
    await main.cancel_verification.callback(it, pid)
    assert "2회 기록이 남아" in it.text()
    assert len([d for d in raw.collection("checkIns").stream() if d.to_dict()["planId"] == pid]) == 2

async def test_goal_completion_and_undo(store, raw):
    deadline = core.day_str(core.get_base_date() + timedelta(days=5))
    await main.plan_deadline.callback(FakeInteraction(ALICE), deadline, "접수")
    pid = plan_id(store, ALICE, "접수")
    await main.verify_study.callback(FakeInteraction(ALICE), pid)
    doc = raw.collection("plans").document(pid).get().to_dict()
    assert doc["status"] == "completed" and doc["completedAt"] == TODAY
    assert Store.find_plan(store.view(ALICE.id), pid) == (None, None)  # 목록에서 빠짐
    choices = await main.cancel_autocomplete(FakeInteraction(ALICE), "")
    assert [c.value for c in choices] == [pid]
    it = FakeInteraction(ALICE)
    await main.cancel_verification.callback(it, pid)
    assert "다시 계획 목록" in it.text()
    doc = raw.collection("plans").document(pid).get().to_dict()
    assert doc["status"] == "active" and "completedAt" not in doc
    assert not raw.collection("checkIns").document(f"{pid}_{TODAY}").get().exists

async def test_app_writes_reach_bot_in_real_time(store, raw):
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("day"), "독서")
    pid = plan_id(store, ALICE, "독서")
    # 앱에서 인증 (앱 규칙 형식)
    from google.cloud import firestore
    raw.collection("checkIns").document(f"{pid}_{TODAY}").set(
        {"planId": pid, "ownerId": str(ALICE.id), "date": TODAY, "source": "app", "createdAt": firestore.SERVER_TIMESTAMP})
    await until(lambda: TODAY in Store.find_plan(store.view(ALICE.id), pid)[1]["history"])
    assert pid not in [c.value for c in await main.plan_autocomplete(FakeInteraction(ALICE), "")]
    # 앱에서 휴식권 사용 → 디스코드에서 같은 달 두 번째는 거부
    raw.collection("offDays").document(f"{ALICE.id}_rest_{TODAY[:7]}").set(
        {"ownerId": str(ALICE.id), "type": "rest", "date": TODAY, "createdAt": firestore.SERVER_TIMESTAMP})
    await until(lambda: TODAY in store.view(ALICE.id)["rest_history"])
    it = FakeInteraction(ALICE)
    await main.take_rest.callback(it)
    assert "이미" in it.text()
    await main.take_rest.callback(FakeInteraction(ALICE), Choice("cancel"))
    assert not raw.collection("offDays").document(f"{ALICE.id}_rest_{TODAY[:7]}").get().exists
    await main.take_rest.callback(FakeInteraction(ALICE))
    assert raw.collection("offDays").document(f"{ALICE.id}_rest_{TODAY[:7]}").get().exists

async def test_delete_plan_keeps_history(store, raw):
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("day"), "청소")
    pid = plan_id(store, ALICE, "청소")
    await main.verify_study.callback(FakeInteraction(ALICE), pid)
    await main.plan_delete.callback(FakeInteraction(ALICE), pid)
    assert raw.collection("plans").document(pid).get().to_dict()["status"] == "deleted"
    assert raw.collection("checkIns").document(f"{pid}_{TODAY}").get().exists
    assert Store.find_plan(store.view(ALICE.id), pid) == (None, None)
    # 같은 이름으로 다시 등록 가능
    await main.plan_register.callback(FakeInteraction(ALICE), Choice("day"), "청소")
    assert plan_id(store, ALICE, "청소") != pid

async def test_settlement_fines_once_and_rest_excuses(store, raw):
    now = datetime(2026, 11, 9, 12, 0, tzinfo=core.KST)  # 월요일
    await store.add_plan(ALICE.id, "Daily", {"content": "운동"}, "2026-10-01")
    await store.add_plan(BOB.id, "Daily", {"content": "독서"}, "2026-10-01")
    await store.add_plan(BOB.id, "Limit", {"content": "몬스터", "period": "week", "limit": 0}, "2026-10-01")
    await store.add_plan(CAROL.id, "Weekly", {"content": "코딩", "count": 3}, "2026-10-01")
    await store.add_rest(BOB.id, "2026-11-08")
    bob_limit = plan_id(store, BOB, "몬스터")
    await store.add_check_in(Store.find_plan(store.view(BOB.id), bob_limit)[1], "2026-11-05", BOB.id)
    carol = Store.find_plan(store.view(CAROL.id), "코딩")[1]
    for day in ("2026-11-03", "2026-11-05", "2026-11-07"):
        await store.add_check_in(carol, day, CAROL.id)

    main.bot_state = {"last_settlement_date": "2026-11-08"}
    channel = FakeChannel()
    await main.run_daily_settlement(channel, now)
    fines = {d.id: d.to_dict()["fines"] for d in raw.collection("members").stream()}
    assert fines[str(ALICE.id)] == 3000                 # 어제 일일 계획 안 함
    assert fines[str(BOB.id)] == 3000                   # 휴식이지만 제한 초과는 벌금
    assert fines.get(str(CAROL.id), 0) == 0             # 주 3회 달성
    events = [d.to_dict() for d in raw.collection("fineEvents").stream()]
    assert len(events) == 2 and all(e["kind"] == "settlement" and e["date"] == "2026-11-08" for e in events)
    assert raw.collection("botState").document("state").get().to_dict()["last_settlement_date"] == "2026-11-09"
    text = "\n".join(f.value for _, e in channel.sent if e for f in e.fields)
    assert "[제한]몬스터" in text and "[일일]독서" not in text  # 휴식이 미인증은 봐줌

    # 정산 기록이 사라져 다시 돌아도 벌금은 한 번만
    main.bot_state = {"last_settlement_date": "2026-11-08"}
    await main.run_daily_settlement(FakeChannel(), now)
    assert {d.id: d.to_dict()["fines"] for d in raw.collection("members").stream()}[str(ALICE.id)] == 3000
    assert len(list(raw.collection("fineEvents").stream())) == 2

async def test_admin_fine_adjust(store, raw):
    it = FakeInteraction(CAROL)
    await main.adjust_fine.callback(it, ALICE, Choice(-1))
    assert "남은 벌금이 없어요" in it.text()
    await main.adjust_fine.callback(FakeInteraction(CAROL), ALICE, Choice(1), "지각")
    await main.adjust_fine.callback(FakeInteraction(CAROL), ALICE, Choice(1))
    await main.adjust_fine.callback(FakeInteraction(CAROL), ALICE, Choice(-1), "납부")
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["fines"] == 3000
    kinds = sorted(d.to_dict()["amount"] for d in raw.collection("fineEvents").stream())
    assert kinds == [-3000, 3000, 3000]

async def test_immunity_vote_creates_exemptions(store, raw):
    for user in (ALICE, BOB):
        await store.add_plan(user.id, "Daily", {"content": "운동"}, TODAY)
    guild = FakeGuild([ALICE, BOB, CAROL])  # 캐럴은 계획 없음 → 투표 불가
    it = FakeInteraction(ALICE, guild)
    await main.request_immunity.callback(it, "아파요")
    vote = raw.collection("votes").document("4242").get().to_dict()
    assert vote["eligible_voters"] == [BOB.id] and vote["required_votes"] == 1 and vote["target_dates"] == [TODAY]

    view = main.ImmunityView(4242, ALICE.id, vote["target_dates"], [], [], vote["total_members"],
                             vote["required_votes"], vote["eligible_voters"])
    carol_it = FakeInteraction(CAROL, guild, message=it.message)
    await view.agree_button.callback(carol_it)
    assert "참가자만" in carol_it.text()
    await view.agree_button.callback(FakeInteraction(BOB, guild, message=it.message))
    assert raw.collection("offDays").document(f"{ALICE.id}_exempt_{TODAY}").get().to_dict()["type"] == "exempt"
    assert not raw.collection("votes").document("4242").get().exists
    assert TODAY in store.view(ALICE.id)["exemptions"]

async def test_members_and_server_info(store, raw):
    await store.ensure_member(ALICE.id, "앨리스")
    await store.ensure_member(ALICE.id, "앨리스(개명)")
    doc = raw.collection("members").document(str(ALICE.id)).get().to_dict()
    assert doc["displayName"] == "앨리스(개명)" and doc["uid"] is None and doc["alertHour"] == 2
    await main.set_alert_time.callback(FakeInteraction(ALICE), 23)
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["alertHour"] == 23
    await store.set_server_info(9, "돈까스 스터디", None)
    assert raw.collection("server").document("info").get().to_dict()["name"] == "돈까스 스터디"

async def test_backup_exports_firestore(store, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "BACKUP_DIR", tmp_path)
    await store.add_plan(ALICE.id, "Daily", {"content": "운동"}, TODAY)
    await main.run_daily_backup(datetime(2026, 11, 9, 13, tzinfo=core.KST))
    import json
    exported = json.loads((tmp_path / "2026-11-09" / "firestore.json").read_text(encoding="utf-8"))
    assert len(exported["plans"]) == 1 and set(exported) >= {"members", "checkIns", "fineEvents", "offDays"}
    # 백업을 만든 뒤 날짜를 기록 → 같은 날 다시 돌면 건너뜀
    assert (await store.get_state())["last_backup_date"] == "2026-11-09"
    (tmp_path / "2026-11-09" / "firestore.json").unlink()
    await main.run_daily_backup(datetime(2026, 11, 9, 14, tzinfo=core.KST))
    assert not (tmp_path / "2026-11-09" / "firestore.json").exists()
