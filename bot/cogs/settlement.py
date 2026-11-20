"""정산·알림·백업: 매시간 점검(정산, 인증 알림, 백업, 정리), /벌금수정"""
import asyncio
import json
import os
import re
import shutil
import traceback
from datetime import timedelta

import discord
from discord import app_commands
from discord.ext import commands, tasks

import core
import shared
from core import CATEGORY_KR, PLAN_CATEGORIES, day_str
from messages import build_embeds, send_embeds, send_long_message
from shared import FINE_AMOUNT, SETTLEMENT_HOUR, LongText

#자동 백업 (하루 한 번, backups/날짜/ 폴더에 Firestore 공용 데이터 저장)
BACKUP_DIR = shared.BASE_DIR / "backups"
BACKUP_KEEP_DAYS = 14  # 최근 14일치만 보관

def _atomic_write_text(path, text):
    # 임시 파일에 다 쓴 다음 한 번에 교체 → 저장 도중 꺼져도 기존 파일이 깨지지 않음
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def _write_backup(date_str, exported):
    folder = BACKUP_DIR / date_str
    folder.mkdir(parents=True, exist_ok=True)
    _atomic_write_text(folder / "firestore.json", json.dumps(exported, indent=2, ensure_ascii=False))

    # 오래된 백업 삭제 (날짜 이름 폴더만 대상)
    dated = sorted(p for p in BACKUP_DIR.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.name))
    for old in dated[:-BACKUP_KEEP_DAYS]:
        shutil.rmtree(old)

async def run_daily_backup(now):
    today_str = day_str(now)
    if shared.bot_state.get("last_backup_date") == today_str:
        return
    exported = await shared.store.export_all()
    await asyncio.get_running_loop().run_in_executor(None, _write_backup, today_str, exported)
    shared.bot_state["last_backup_date"] = today_str
    await shared.save_state()
    print(f"💾 데이터 백업 완료: backups/{today_str}/")

async def run_daily_settlement(channel, now):
    """하루 한 번, SETTLEMENT_HOUR시 이후 처음 도는 시점에 어제 기록을 정산"""
    store = shared.store
    today_str = day_str(now)
    if now.hour < SETTLEMENT_HOUR or shared.bot_state.get("last_settlement_date") == today_str:
        return

    yesterday_str = day_str(now - timedelta(days=1))
    is_monday, is_first_day = now.weekday() == 0, now.day == 1

    fine_msg_list = []
    for user_id, view in list(store.all_views().items()):
        try:
            fined, kind, details = core.settle_user(view, now)
        except Exception:
            # 한 사람 데이터가 이상해도 나머지 사람 정산은 계속 진행
            print(f"🚨 정산 중 오류 (유저 {user_id}), 이 유저는 건너뜁니다:")
            traceback.print_exc()
            continue

        if fined:
            # 벌금 내역 ID를 날짜·사람으로 고정 → 정산이 두 번 돌아도 한 번만 매겨짐
            await store.add_fine(user_id, FINE_AMOUNT, ", ".join(details)[:500], yesterday_str, "settlement",
                                 event_id=f"settle_{yesterday_str}_{user_id}")
            fine_msg_list.append(f"💸 <@{user_id}>님 **{FINE_AMOUNT}원** 벌금! ({', '.join(details)})")
        elif kind == 'rest':
            fine_msg_list.append(f"🛌 <@{user_id}>님 **휴식권 사용!** (푹 쉬셨나요? 🍯)")
        elif kind == 'exempt':
            fine_msg_list.append(f"🛡️ <@{user_id}>님 면책 통과! ({', '.join(details)})")

    shared.bot_state["last_settlement_date"] = today_str
    await shared.save_state()
    print(f"💸 {yesterday_str} 정산 완료 ({len(fine_msg_list)}건)")

    if not fine_msg_list:
        return

    rank_lines = []
    for uid, view in sorted(store.all_views().items(), key=lambda kv: kv[1].get('fines', 0), reverse=True):
        fine = view.get('fines', 0)
        if fine > 0:
            rank = len(rank_lines) + 1
            icon = ["🥇", "🥈", "🥉"][rank-1] if rank <= 3 else f"{rank}."
            rank_lines.append(f"{icon} <@{uid}>: **{fine:,}원**")

    title_txt = f"💸 {yesterday_str} 정산"
    if is_monday: title_txt += " (주간결산 포함)"
    if is_first_day: title_txt += " (월간결산 포함)"

    fields = [("🧾 정산 결과", "\n".join(fine_msg_list), False)]
    if rank_lines: fields.append(("🏆 명예의 전당", "\n".join(rank_lines), False))

    embeds = build_embeds(
        title=title_txt,
        color=discord.Color.red(),
        description="**돈** 내기 싫으면 **까**먹지 말고 **스**스로 해라",
        fields=fields,
    )
    await send_embeds(channel, embeds)

async def send_hourly_alerts(channel, now):
    """각자 설정한 알림 시간(기본 2시)에 아직 인증 안 한 계획을 알려줌"""
    alert_date = core.get_base_date(now)  # 새벽 0~4시는 전날 기록을 검사
    alert_date_str = day_str(alert_date)

    for user_id, view in list(shared.store.all_views().items()):
        if view.get('alert_time', 2) != now.hour:
            continue
        # 휴식/면책 날에는 알림 안 보냄
        if alert_date_str in view.get('exemptions', []) or alert_date_str in view.get('rest_history', []):
            continue
        try:
            todo = core.find_todo_plans(view, alert_date)
        except Exception:
            print(f"🚨 알림 확인 중 오류 (유저 {user_id}), 이 유저는 건너뜁니다:")
            traceback.print_exc()
            continue
        if not any(todo.values()):
            continue

        msg = f"🔔 <@{user_id}>님! 인증할 시간이에요!\n"
        for category in PLAN_CATEGORIES:
            if todo[category]:
                msg += f"- **[{CATEGORY_KR[category]}]** {', '.join(todo[category])}\n"
        await send_long_message(channel, msg)

async def run_cleanup():
    """쓰지 않은 연동 코드와 오래된 면책 투표 정리"""
    removed = await shared.store.cleanup_link_codes()
    if removed:
        print(f"🧹 쓰지 않은 연동 코드 {removed}개 정리")
    expired = await shared.store.expire_votes()
    if expired:
        print(f"🧹 대상 날짜가 지난 면책 투표 {len(expired)}개 정리")

class Settlement(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self):
        self.hourly_check.start()

    async def cog_unload(self):
        self.hourly_check.cancel()

    #감시자
    @tasks.loop(minutes=60)
    async def hourly_check(self):
        # 각 단계를 따로 감싸서, 한 곳에서 오류가 나도 반복 작업 자체는 멈추지 않게 함
        try:
            restarted = shared.store.ensure_watching()
            if restarted:
                print(f"🔁 Firestore 실시간 연결 재시작: {', '.join(restarted)}")
        except Exception:
            traceback.print_exc()

        now = core.get_now()
        print(f"⏰ 점검 중... {now.month}/{now.day} {now.hour}시 (인증기준: {day_str(core.get_base_date(now))})")

        channel = self.bot.get_channel(shared.ALERT_CHANNEL)
        if not channel:
            print("⚠️ 경고: ALERT_CHANNEL을 찾을 수 없어 정산/알림을 건너뜁니다. .env의 ID를 확인해주세요.")
            return

        for name, step in (("벌금 정산", run_daily_settlement), ("인증 알림 전송", send_hourly_alerts)):
            try:
                await step(channel, now)
            except Exception:
                print(f"🚨 {name} 중 오류:")
                traceback.print_exc()

        try:
            await run_daily_backup(now)
        except Exception:
            print("🚨 데이터 백업 중 오류:")
            traceback.print_exc()

        try:
            await run_cleanup()
        except Exception:
            traceback.print_exc()

    #정각 대기
    @hourly_check.before_loop
    async def before_hourly_check(self):
        await self.bot.wait_until_ready()
        now = core.get_now()
        future = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        seconds_until_next_hour = (future - now).total_seconds()
        print(f"⏳ 다음 정각({future.hour}시)까지 {int(seconds_until_next_hour)}초 대기합니다...")
        await asyncio.sleep(seconds_until_next_hour)

    #벌금 수정 (관리자, 3,000원씩 더하거나 빼기)
    @app_commands.command(name="벌금수정", description=f"[관리자] 특정 유저의 벌금을 {FINE_AMOUNT:,}원 더하거나 뺍니다.")
    @app_commands.describe(유저="대상 유저", 동작=f"+{FINE_AMOUNT:,}원 / -{FINE_AMOUNT:,}원", 사유="수정 사유 (선택)")
    @app_commands.choices(동작=[
        app_commands.Choice(name=f"+ {FINE_AMOUNT:,}원 (벌금 추가)", value=1),
        app_commands.Choice(name=f"- {FINE_AMOUNT:,}원 (벌금 차감, 예: 납부)", value=-1),
    ])
    @app_commands.checks.has_permissions(administrator=True)
    async def adjust_fine(self, interaction: discord.Interaction, 유저: discord.Member, 동작: app_commands.Choice[int], 사유: LongText = "관리자 수정"):
        store = shared.store
        await store.ensure_member(유저.id, 유저.display_name)
        old_fine = store.view(유저.id).get('fines', 0)

        if 동작.value < 0 and old_fine <= 0:
            await interaction.response.send_message(f"❌ **{유저.display_name}**님은 남은 벌금이 없어요.", ephemeral=True)
            return

        # 0원 아래로는 내려가지 않음
        amount = FINE_AMOUNT if 동작.value > 0 else -min(FINE_AMOUNT, old_fine)
        await store.add_fine(유저.id, amount, 사유, day_str(core.get_base_date()), "admin")
        new_fine = old_fine + amount

        embed = discord.Embed(title="🔧 벌금 조정 완료", color=discord.Color.gold())
        embed.add_field(name="대상", value=유저.mention, inline=True)
        embed.add_field(name="변경 전", value=f"{old_fine:,}원", inline=True)
        embed.add_field(name="변경 후", value=f"**{new_fine:,}원**", inline=True)
        embed.add_field(name="사유", value=사유, inline=False)
        await interaction.response.send_message(embed=embed)

async def setup(bot):
    await bot.add_cog(Settlement(bot))
