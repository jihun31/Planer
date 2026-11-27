import asyncio
import os
import subprocess
import sys
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

import core
import main
import shared
from cogs import account, checkins, offdays, plans, settlement
from conftest import BOT_DIR, COGS, Choice, FakeChannel, FakeGuild, FakeInteraction, FakeMessage, FakeUser, cmd
from store import Store
from tools import migrate_json_to_firestore as mig

ALICE = FakeUser(100000000000000001, "앨리스")
BOB = FakeUser(100000000000000002, "밥")
CAROL = FakeUser(100000000000000003, "캐럴")
TODAY = core.day_str(core.get_base_date())


def plan_id(s, owner, content):
    return Store.find_plan(s.view(owner.id), content)[1]["id"]


# 1. 공백 계획 저장 차단 및 백그라운드 태스크 참조 보관
async def test_whitespace_plan_rejected_in_register_edit_and_migrate(store, raw):
    it = FakeInteraction(ALICE)
    await cmd.plan_register(it, Choice("day"), "   ")
    assert it.sent and it.sent[0][2] is True
    assert list(raw.collection("plans").stream()) == []

    # 앞뒤 공백은 strip하여 저장하고 중복 검사에도 반영
    await cmd.plan_register(FakeInteraction(ALICE), Choice("day"), "  운동  ")
    pid = plan_id(store, ALICE, "운동")
    assert raw.collection("plans").document(pid).get().to_dict()["content"] == "운동"

    dup_it = FakeInteraction(ALICE)
    await cmd.plan_register(dup_it, Choice("day"), " 운동 ")
    assert "이미" in dup_it.text()
    assert len(list(raw.collection("plans").stream())) == 1

    # plan_edit에서 공백만 입력 시 거부
    edit_it = FakeInteraction(ALICE)
    await cmd.plan_edit(edit_it, pid, 내용="   ")
    assert "❌" in edit_it.text()
    assert raw.collection("plans").document(pid).get().to_dict()["content"] == "운동"

    # migrate_json_to_firestore에서 공백 계획 건너뜀
    writes, warnings = mig.convert(
        {str(ALICE.id): {"Daily": [{"content": "   "}, {"content": "독서"}]}},
        {},
        {},
    )
    plan_docs = [doc for col, _, doc, _ in writes if col == "plans"]
    assert [d["content"] for d in plan_docs] == ["독서"]
    assert any("비어" in w or "공백" in w for w in warnings)


async def test_plans_bg_task_reference_kept(store, monkeypatch):
    gate = asyncio.Event()
    announced = []

    async def slow_announce(owner_id, content, changes, where):
        await gate.wait()
        announced.append((owner_id, content, changes, where))

    monkeypatch.setattr(COGS.plans, "announce_plan_edit", slow_announce)
    COGS.plans.install_store_hooks(store)
    assert hasattr(COGS.plans, "_bg_tasks")

    old = {"ownerId": str(ALICE.id), "category": "Daily", "content": "운동", "photo": True}
    new = {"ownerId": str(ALICE.id), "category": "Daily", "content": "운동", "photo": False}
    task = store.on_plan_edit(old, new)
    assert task in COGS.plans._bg_tasks

    gate.set()
    await task
    await asyncio.sleep(0)
    assert task not in COGS.plans._bg_tasks
    assert len(announced) == 1


# 2. 길드 전용 명령어 DM 차단
def test_guild_only_on_all_guild_commands():
    assert account.Account.set_alert_time.guild_only is True
    assert account.Account.link_app.guild_only is True
    assert plans.Plans.plan_group.guild_only is True
    assert plans.Plans.check_my_plans.guild_only is True
    assert checkins.CheckIns.verify_study.guild_only is True
    assert checkins.CheckIns.cancel_verification.guild_only is True
    assert offdays.OffDays.request_immunity.guild_only is True
    assert offdays.OffDays.take_rest.guild_only is True
    assert offdays.OffDays.check_monthly_status.guild_only is True
    assert settlement.Settlement.adjust_fine.guild_only is True


# 3. 면책 투표 동시성 · 3초 타임아웃(defer) · 빈 embeds 방어 · 저장 순서 · view stop
async def test_immunity_vote_saves_before_exposing_buttons(store, monkeypatch):
    for user in (ALICE, BOB):
        await store.add_plan(user.id, "Daily", {"content": "운동"}, TODAY)
    guild = FakeGuild([ALICE, BOB])
    order = []

    orig_set_vote = store.set_vote

    async def tracked_set_vote(msg_id, data):
        order.append("set_vote")
        return await orig_set_vote(msg_id, data)

    monkeypatch.setattr(store, "set_vote", tracked_set_vote)
    it = FakeInteraction(ALICE, guild)
    orig_edit = it.edit_original_response

    async def tracked_edit(**kw):
        order.append("edit_original_response")
        return await orig_edit(**kw)

    monkeypatch.setattr(it, "edit_original_response", tracked_edit)

    await cmd.request_immunity(it, "아파요")
    assert order == ["set_vote", "edit_original_response"]


async def test_immunity_vote_concurrency_defer_empty_embeds_and_stop(store, raw, monkeypatch):
    for user in (ALICE, BOB, CAROL):
        await store.add_plan(user.id, "Daily", {"content": "운동"}, TODAY)
    guild = FakeGuild([ALICE, BOB, CAROL])

    await store.set_vote(5555, {
        "target_id": ALICE.id,
        "target_dates": [TODAY],
        "reason": "아파요",
        "agreed_users": [],
        "denied_users": [],
        "total_members": 3,
        "required_votes": 1,
        "eligible_voters": [BOB.id, CAROL.id],
    })
    view = offdays.ImmunityView(5555, ALICE.id, [TODAY], [], [], 3, 1, [BOB.id, CAROL.id])

    exemption_calls = 0
    orig_add_exemptions = store.add_exemptions

    async def slow_add_exemptions(owner_id, dates):
        nonlocal exemption_calls
        exemption_calls += 1
        await asyncio.sleep(0.05)
        return await orig_add_exemptions(owner_id, dates)

    monkeypatch.setattr(store, "add_exemptions", slow_add_exemptions)

    # embeds가 비어 있는 메시지로도 크래시하지 않고 동시 클릭 시 1회만 통과
    empty_msg = FakeMessage(5555, embed=None)
    it_bob = FakeInteraction(BOB, guild, message=empty_msg, message_id=5555)
    it_carol = FakeInteraction(CAROL, guild, message=empty_msg, message_id=5555)

    await asyncio.gather(
        view.agree_button.callback(it_bob),
        view.agree_button.callback(it_carol),
    )

    assert exemption_calls == 1
    assert it_bob.response.deferred is True
    assert it_carol.response.deferred is True
    assert view.is_finished() is True
    assert not raw.collection("votes").document("5555").get().exists


async def test_immunity_vote_deny_and_expire_call_stop(store, raw):
    # 부결 시 stop() 호출
    await store.set_vote(6666, {
        "target_id": ALICE.id,
        "target_dates": [TODAY],
        "reason": "사유",
        "agreed_users": [],
        "denied_users": [],
        "total_members": 2,
        "required_votes": 1,
        "eligible_voters": [BOB.id],
    })
    deny_view = offdays.ImmunityView(6666, ALICE.id, [TODAY], [], [], 2, 1, [BOB.id])
    it_bob = FakeInteraction(BOB, FakeGuild([ALICE, BOB]), message=FakeMessage(6666, embed=None), message_id=6666)
    await deny_view.deny_button.callback(it_bob)
    assert it_bob.response.deferred is True
    assert deny_view.is_finished() is True

    # 만료 정리 시 stop() 호출
    await store.set_vote(7777, {
        "target_id": ALICE.id,
        "target_dates": ["2020-01-01"],
        "reason": "오래된 투표",
        "agreed_users": [],
        "denied_users": [],
        "total_members": 2,
        "required_votes": 1,
        "eligible_voters": [BOB.id],
    })
    stale_view = offdays.ImmunityView(7777, ALICE.id, ["2020-01-01"], [], [], 2, 1, [BOB.id])
    await settlement.run_cleanup()
    assert stale_view.is_finished() is True
    assert not raw.collection("votes").document("7777").get().exists


# 4. 정산 · 알림 스케줄러 및 벌금 차감 신뢰성
async def test_settlement_saves_date_after_send_and_isolates_add_fine_errors(store, raw, monkeypatch):
    now = datetime(2026, 11, 9, 12, 0, tzinfo=core.KST)
    store.refresh_window(now)
    await store.add_plan(ALICE.id, "Daily", {"content": "운동"}, "2026-10-01")
    await store.add_plan(BOB.id, "Daily", {"content": "독서"}, "2026-10-01")
    shared.bot_state = {"last_settlement_date": "2026-11-08"}

    # 1) 전송 실패 시 last_settlement_date 저장 안 됨 → 다음 실행 때 공지 재전송 + 벌금 중복 없음
    class FailingChannel:
        async def send(self, *_, **__):
            raise RuntimeError("discord unavailable")

    with pytest.raises(RuntimeError):
        await settlement.run_daily_settlement(FailingChannel(), now)
    assert shared.bot_state.get("last_settlement_date") == "2026-11-08"

    ok_channel = FakeChannel()
    await settlement.run_daily_settlement(ok_channel, now)
    assert shared.bot_state.get("last_settlement_date") == "2026-11-09"
    assert len(ok_channel.sent) == 1
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["fines"] == 3000
    assert raw.collection("members").document(str(BOB.id)).get().to_dict()["fines"] == 3000

    # 2) 한 유저 add_fine 실패 시 다른 유저 정산은 계속 진행
    now2 = datetime(2026, 11, 10, 12, 0, tzinfo=core.KST)
    orig_add_fine = store.add_fine

    async def flaky_add_fine(user_id, *args, **kwargs):
        if str(user_id) == str(ALICE.id):
            raise RuntimeError("transient firestore error")
        return await orig_add_fine(user_id, *args, **kwargs)

    monkeypatch.setattr(store, "add_fine", flaky_add_fine)
    ok_channel2 = FakeChannel()
    await settlement.run_daily_settlement(ok_channel2, now2)
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["fines"] == 3000
    assert raw.collection("members").document(str(BOB.id)).get().to_dict()["fines"] == 6000


async def test_hourly_check_runs_backup_and_cleanup_without_alert_channel(store, monkeypatch):
    monkeypatch.setattr(main.bot, "get_channel", lambda _id: None)
    called = []

    async def fake_backup(_now):
        called.append("backup")

    async def fake_cleanup():
        called.append("cleanup")

    monkeypatch.setattr(settlement, "run_daily_backup", fake_backup)
    monkeypatch.setattr(settlement, "run_cleanup", fake_cleanup)

    await COGS.settlement.hourly_check.coro(COGS.settlement)
    assert called == ["backup", "cleanup"]


async def test_admin_fine_deduct_concurrent_never_negative(store, raw):
    await cmd.adjust_fine(FakeInteraction(CAROL), ALICE, Choice(1), "지각")
    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["fines"] == 3000

    its = [FakeInteraction(CAROL) for _ in range(3)]
    await asyncio.gather(*(cmd.adjust_fine(it, ALICE, Choice(-1), "납부") for it in its))

    assert raw.collection("members").document(str(ALICE.id)).get().to_dict()["fines"] == 0
    deduct_events = [d.to_dict() for d in raw.collection("fineEvents").stream() if d.to_dict()["amount"] < 0]
    assert len(deduct_events) == 1
    assert deduct_events[0]["amount"] == -3000


# 5. Store 수명주기 · 중복 인증 · 기동 검증
async def test_duplicate_check_in_does_not_resend_or_overwrite_message_url(store, raw):
    await cmd.plan_register(FakeInteraction(ALICE), Choice("day"), "운동")
    pid = plan_id(store, ALICE, "운동")

    it1 = FakeInteraction(ALICE, message_id=1001)
    await cmd.verify_study(it1, pid)
    first_url = raw.collection("checkIns").document(f"{pid}_{TODAY}").get().to_dict()["messageUrl"]
    assert first_url.endswith("/1001")
    assert it1.sent[0][1] is not None and it1.sent[0][2] is False  # 공개 임베드 전송

    it2 = FakeInteraction(ALICE, message_id=2002)
    await cmd.verify_study(it2, pid)
    assert it2.sent[0][1] is None and it2.sent[0][2] is True  # 공개 임베드 재전송 안 함, ephemeral 안내
    assert raw.collection("checkIns").document(f"{pid}_{TODAY}").get().to_dict()["messageUrl"] == first_url


def test_missing_token_raises_runtime_error():
    env = {k: v for k, v in os.environ.items() if k != "TOKEN"}
    env["TOKEN"] = ""
    env["ALERT_CHANNEL"] = "2"
    env["WELCOME_CHANNEL"] = "4"
    res = subprocess.run(
        [sys.executable, "-c", "import shared"],
        cwd=str(BOT_DIR),
        env=env,
        capture_output=True,
        text=True,
    )
    assert res.returncode != 0
    assert "TOKEN" in (res.stderr + res.stdout)


async def test_bot_on_ready_sync_flag_and_close_cleans_store(monkeypatch):
    bot = main.TonkatsuBot()

    # sync 실패 시 commands_synced는 False 유지
    resp = MagicMock()
    resp.status = 500
    resp.reason = "Internal Server Error"
    bot.tree.sync = AsyncMock(side_effect=discord.HTTPException(resp, "sync failed"))
    await bot.on_ready()
    assert bot.commands_synced is False

    # 다음 시도에 성공하면 True
    bot.tree.sync = AsyncMock(return_value=[])
    await bot.on_ready()
    assert bot.commands_synced is True

    # close()가 shared.store.stop()과 클라이언트 close()를 호출
    fake_store = MagicMock()
    fake_store.stop = MagicMock()
    fake_store.close = MagicMock()
    monkeypatch.setattr(shared, "store", fake_store)
    await bot.close()
    fake_store.stop.assert_called_once()
    fake_store.close.assert_called_once()
