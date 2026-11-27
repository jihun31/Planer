"""계획: /계획 등록·요일·n일·목표·삭제·수정, /계획표, 앱에서 바꾼 계획 조건 알림"""
import asyncio
import traceback
from datetime import datetime

import discord
from discord import app_commands
from discord.ext import commands

import core
import shared
from core import CATEGORY_KR, LIMIT_PERIOD_KR, PLAN_CATEGORIES, WEEKDAY_NAMES, day_str
from messages import build_embeds, fit_choice, respond_embeds
from shared import PHOTO_CHOICES, PlanText
from store import Store

CATEGORY_TITLES = {
    "Daily": "🌞 매일 (Daily)",
    "Routine": "🔄 요일 (Routine)",
    "Weekly": "📅 주간 (Weekly)",
    "Monthly": "🗓️ 월간 (Monthly)",
    "Interval": "🔁 반복 (Interval)",
    "OneTime": "🎯 목표 (One-Time)",
    "Limit": "🚫 제한 (Limit)"
}

def photo_icon(photo_required):
    return "📸 사진 필수" if photo_required else "📝 내용만"

async def register_plan(interaction: discord.Interaction, category: str, fields: dict) -> bool:
    """중복 이름을 검사하고 계획을 저장함. 공백만 있거나 중복이면 안내 메시지를 보내고 False를 돌려줌."""
    content = (fields.get('content') or '').strip()
    if not content:
        await interaction.response.send_message("❌ 계획 내용은 공백만으로 등록할 수 없어요.", ephemeral=True)
        return False
    fields = {**fields, 'content': content}
    user_id = str(interaction.user.id)
    existing_category, _ = Store.find_plan(shared.store.view(user_id), content)
    if existing_category:
        await interaction.response.send_message(f"✋ **'{content}'** 계획은 이미 [{CATEGORY_KR[existing_category]}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
        return False
    # 등록일은 오늘 (새벽 0~4시면 전날). 이전 기간은 정산하지 않음
    await shared.store.add_plan(user_id, category, fields, day_str(core.get_base_date()))
    return True

#자동완성(삭제·수정) - 모든 계획을 보여줌. 선택 값은 계획 ID
async def plan_autocomplete_delete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    choices = []
    for category, plan in core.iter_plans(shared.store.view(interaction.user.id)):
        if category == "Weekly": tag = f"주{plan.get('count', 1)}회"
        elif category == "Interval": tag = f"{plan.get('interval', 1)}일장"
        elif category == "Limit": tag = f"제한 {LIMIT_PERIOD_KR.get(plan.get('period'), '')} {plan.get('limit', 0)}회"
        else: tag = CATEGORY_KR[category]
        name = f"[{tag}] {plan['content']}"
        if current.lower() in name.lower():
            choices.append(app_commands.Choice(name=fit_choice(name), value=plan['id']))
    return choices[:25]

class Plans(commands.Cog):
    plan_group = app_commands.Group(name="계획", description="나만의 계획을 세웁니다.", guild_only=True)

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self._bg_tasks: set[asyncio.Task] = set()

    def _spawn_bg_task(self, coro):
        task = asyncio.create_task(coro)
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)
        return task

    async def cog_load(self):
        self.install_store_hooks(shared.store)

    def install_store_hooks(self, s):
        """앱에서 계획 조건을 바꾸면 디스코드에 알림"""
        s.on_plan_edit = lambda old, new: self._spawn_bg_task(
            self.announce_plan_edit(new.get("ownerId"), new.get("content"), core.describe_plan_changes(old, new), "앱"))

    async def announce_plan_edit(self, owner_id, content, changes, where):
        """계획 조건이 바뀌면 알림 채널에 공개 (벌금 피하려는 수정을 서로 볼 수 있게)"""
        channel = self.bot.get_channel(shared.ALERT_CHANNEL)
        if not channel or not changes:
            return
        name = (shared.store.data["members"].get(str(owner_id)) or {}).get("displayName") or f"<@{owner_id}>"
        try:
            await channel.send(f"✏️ **{name}**님이 **'{content}'** 계획을 바꿨어요 ({where}): " + ", ".join(changes),
                               allowed_mentions=discord.AllowedMentions.none())
        except Exception:
            traceback.print_exc()

    #계획 등록 (매일/주간/월간 + 제한)
    @plan_group.command(name="등록", description="매일/주간/월간 계획을 세웁니다. 제한 O면 'N회 이하로 참기' 계획이 돼요.")
    @app_commands.describe(
        주기="매일 / 주간(월~일) / 월간",
        내용="내용 (예: 운동, 몬스터)",
        횟수="주간·월간: 목표 횟수 / 제한: 최대 횟수 (매일 목표는 입력 안 해도 됨)",
        제한="O: 횟수를 넘기면 벌금 (예: 몬스터 주 2회 이하) / X: 횟수 이상 하기 (기본)",
        사진인증="인증할 때 사진 필수 여부 (기본 X)",
    )
    @app_commands.choices(
        주기=[
            app_commands.Choice(name="매일", value="day"),
            app_commands.Choice(name="주간 (월~일)", value="week"),
            app_commands.Choice(name="월간", value="month"),
        ],
        제한=[
            app_commands.Choice(name="X (N회 이상 하기)", value=0),
            app_commands.Choice(name="O (N회 이하로 참기, 넘기면 벌금)", value=1),
        ],
        사진인증=PHOTO_CHOICES,
    )
    async def plan_register(self, interaction: discord.Interaction, 주기: app_commands.Choice[str], 내용: PlanText,
                            횟수: app_commands.Range[int, 0, 50] = None,
                            제한: app_commands.Choice[int] = None,
                            사진인증: app_commands.Choice[int] = None):
        period = 주기.value
        is_limit = bool(제한 and 제한.value)
        photo = bool(사진인증 and 사진인증.value)
        period_kr = {"day": "하루", "week": "일주일", "month": "한 달"}[period]

        # 1. 제한 계획: N회 이하
        if is_limit:
            if 횟수 is None:
                await interaction.response.send_message("❌ 제한 계획은 `횟수`(최대 몇 번까지 괜찮은지)를 입력해주세요! 0이면 한 번만 해도 벌금이에요.", ephemeral=True)
                return
            if await register_plan(interaction, "Limit", {"content": 내용, "photo": False, "period": period, "limit": 횟수}):
                await interaction.response.send_message(
                    f"🚫 **[제한] 계획 등록 완료!**\n- **내용:** {내용}\n- **제한:** {period_kr}에 **{횟수}회 이하**\n"
                    f"할 때마다 `/인증`으로 기록하세요. {횟수}회를 넘기면 정산 때 벌금이에요!"
                )
            return

        # 2. 매일 계획: 하루 한 번
        if period == "day":
            if await register_plan(interaction, "Daily", {"content": 내용, "photo": photo}):
                await interaction.response.send_message(f"📅 **[일일] 계획 등록 완료!** ({photo_icon(photo)})\n- **내용:** {내용}")
            return

        # 3. 주간/월간 계획: N회 이상
        max_count = 7 if period == "week" else 31
        if 횟수 is None or not 1 <= 횟수 <= max_count:
            await interaction.response.send_message(f"❌ {주기.name} 계획은 `횟수`를 **1~{max_count}** 사이로 입력해주세요!", ephemeral=True)
            return

        category, type_kr, unit = ("Weekly", "주간", "주") if period == "week" else ("Monthly", "월간", "월")
        if await register_plan(interaction, category, {"count": 횟수, "content": 내용, "photo": photo}):
            await interaction.response.send_message(f"📅 **[{type_kr}] 계획 등록 완료!** ({photo_icon(photo)})\n- **목표:** {unit} {횟수}회\n- **내용:** {내용}")

    #요일 계획
    @plan_group.command(name="요일", description="특정 요일에만 반복할 계획을 세웁니다.")
    @app_commands.describe(내용="내용", 요일="예: 월수금, 토일 (원하는 요일을 붙여서 적으세요)", 사진인증="사진 인증 여부 (기본 X)")
    @app_commands.choices(사진인증=PHOTO_CHOICES)
    async def plan_routine(self, interaction: discord.Interaction, 내용: PlanText, 요일: str, 사진인증: app_commands.Choice[int] = None):
        selected_days = [day for day in WEEKDAY_NAMES if day in 요일]
        if not selected_days:
            await interaction.response.send_message("❌ 요일을 제대로 인식하지 못했어요! **'월수금'**, **'토일'** 처럼 요일 글자를 포함해서 적어주세요.", ephemeral=True)
            return

        photo = bool(사진인증 and 사진인증.value)
        if await register_plan(interaction, "Routine", {"content": 내용, "photo": photo, "days": selected_days}):
            await interaction.response.send_message(f"✅ **[요일] 계획 등록 완료!** ({photo_icon(photo)})\n- **내용:** {내용}\n- **수행 요일:** {', '.join(selected_days)}요일")

    #n일계획
    @plan_group.command(name="n일", description="N일마다 반복하는 계획을 세웁니다")
    @app_commands.describe(간격="며칠마다 할까요? (1~365)", 내용="내용", 사진인증="사진 인증 여부 (기본 X)")
    @app_commands.choices(사진인증=PHOTO_CHOICES)
    async def plan_interval(self, interaction: discord.Interaction, 간격: app_commands.Range[int, 1, 365], 내용: PlanText, 사진인증: app_commands.Choice[int] = None):
        photo = bool(사진인증 and 사진인증.value)
        if await register_plan(interaction, "Interval", {"interval": 간격, "content": 내용, "photo": photo}):
            await interaction.response.send_message(f"📅 **[{간격}일마다] 계획 등록!** ({photo_icon(photo)})\n- **내용:** {내용}")

    #일회성 목표
    @plan_group.command(name="목표", description="특정 날짜까지 완수해야 하는 1회성 목표를 세웁니다.")
    @app_commands.describe(마감일="YYYY-MM-DD 형식 (예: 2026-01-20)", 내용="목표 내용", 사진인증="사진 인증 여부 (기본 X)")
    @app_commands.choices(사진인증=PHOTO_CHOICES)
    async def plan_deadline(self, interaction: discord.Interaction, 마감일: str, 내용: PlanText, 사진인증: app_commands.Choice[int] = None):
        try:
            마감일 = day_str(datetime.strptime(마감일, "%Y-%m-%d"))
        except ValueError:
            await interaction.response.send_message("❌ 날짜 형식이 틀렸어요! **2026-01-20** 처럼 적어주세요.", ephemeral=True)
            return

        photo = bool(사진인증 and 사진인증.value)
        if await register_plan(interaction, "OneTime", {"deadline": 마감일, "content": 내용, "photo": photo}):
            await interaction.response.send_message(f"🎯 **[목표] 등록 완료!** ({photo_icon(photo)})\n- **마감:** {마감일}까지\n- **내용:** {내용}")

    #계획 삭제
    @plan_group.command(name="삭제", description="등록된 계획 중 하나를 선택해 삭제합니다.")
    @app_commands.describe(계획="삭제할 계획을 선택하세요?")
    @app_commands.autocomplete(계획=plan_autocomplete_delete)
    async def plan_delete(self, interaction: discord.Interaction, 계획: str):
        category, plan = Store.find_plan(shared.store.view(interaction.user.id), 계획)
        if not plan:
            await interaction.response.send_message(f"❓ **'{계획}'**라는 계획을 못 찾겠어요. 이미 삭제됐나 봐요!", ephemeral=True)
            return

        await shared.store.delete_plan(plan['id'])
        await interaction.response.send_message(f"🗑️ **[{CATEGORY_KR[category]}] {plan['content']}** 계획을 시원하게 삭제했습니다! 👋")

    #계획 수정
    @plan_group.command(name="수정", description="등록한 계획의 이름·사진 필수 여부·횟수·요일·간격·마감일을 바꿉니다.")
    @app_commands.describe(
        계획="수정할 계획", 내용="새 이름", 사진인증="사진 필수 여부 (제한 계획은 해당 없음)",
        횟수="주간·월간: 목표 횟수 / 제한: 최대 횟수", 요일="요일 계획: 예) 월수금", 간격="N일 계획: 며칠마다", 마감일="목표: YYYY-MM-DD",
    )
    @app_commands.choices(사진인증=PHOTO_CHOICES)
    @app_commands.autocomplete(계획=plan_autocomplete_delete)
    async def plan_edit(self, interaction: discord.Interaction, 계획: str, 내용: PlanText = None, 사진인증: app_commands.Choice[int] = None,
                        횟수: app_commands.Range[int, 0, 50] = None, 요일: str = None,
                        간격: app_commands.Range[int, 1, 365] = None, 마감일: str = None):
        store = shared.store
        category, plan = Store.find_plan(store.view(interaction.user.id), 계획)
        if not plan:
            await interaction.response.send_message(f"❓ **'{계획}'** 계획을 못 찾겠어요.", ephemeral=True)
            return

        async def reject(msg):
            await interaction.response.send_message(f"❌ {msg}", ephemeral=True)

        changes = {}
        if 내용 is not None:
            stripped = 내용.strip()
            if not stripped:
                return await reject("계획 내용은 공백만으로 설정할 수 없어요.")
            if stripped != plan["content"]:
                if Store.find_plan(store.view(interaction.user.id), stripped)[1]:
                    return await reject(f"**'{stripped}'** 이름의 계획이 이미 있어요.")
                changes["content"] = stripped
        if 사진인증 is not None:
            if category == "Limit":
                return await reject("제한 계획은 사진 인증을 쓰지 않아요.")
            changes["photo"] = bool(사진인증.value)
        if 횟수 is not None:
            if category == "Weekly" and 1 <= 횟수 <= 7: changes["count"] = 횟수
            elif category == "Monthly" and 1 <= 횟수 <= 31: changes["count"] = 횟수
            elif category == "Limit": changes["limit"] = 횟수
            else:
                return await reject("횟수는 주간(1~7)·월간(1~31)·제한(0~50) 계획에서만 바꿀 수 있어요.")
        if 요일 is not None:
            days = [d for d in WEEKDAY_NAMES if d in 요일]
            if category != "Routine" or not days:
                return await reject("요일은 요일 계획에서만, '월수금'처럼 적어주세요.")
            changes["days"] = days
        if 간격 is not None:
            if category != "Interval":
                return await reject("간격은 N일 계획에서만 바꿀 수 있어요.")
            changes["interval"] = 간격
        if 마감일 is not None:
            try:
                deadline = day_str(datetime.strptime(마감일, "%Y-%m-%d"))
            except ValueError:
                return await reject("마감일은 **2026-01-20** 처럼 적어주세요.")
            if category != "OneTime":
                return await reject("마감일은 목표 계획에서만 바꿀 수 있어요.")
            changes["deadline"] = deadline

        changes = {k: v for k, v in changes.items() if plan.get(k) != v}
        if not changes:
            await interaction.response.send_message("🤔 바뀐 내용이 없어요. 바꿀 항목을 입력해주세요.", ephemeral=True)
            return

        old = dict(plan)
        await store.edit_plan(plan["id"], changes)
        new = {**old, **changes}
        await interaction.response.send_message(
            f"✏️ **[{CATEGORY_KR[category]}] {new['content']}** 계획을 수정했어요. ({core.condition_text(new)}, 사진 {'필수' if new.get('photo') else 'X'})")
        await self.announce_plan_edit(interaction.user.id, new["content"], core.describe_plan_changes(old, new), "디스코드")

    #계획표
    @app_commands.command(name="계획표", description="나의 계획과 달성 현황을 확인합니다.")
    @app_commands.guild_only()
    async def check_my_plans(self, interaction: discord.Interaction):
        view = shared.store.view(interaction.user.id)
        display_date = core.get_base_date()
        note_date = "(새벽🌙)" if core.is_dawn() else ""

        fields = []
        for category in PLAN_CATEGORIES:
            lines = [core.plan_status_line(view, category, plan, display_date) for _, plan in core.iter_plans(view, categories=[category])]
            if lines:
                fields.append((CATEGORY_TITLES[category], "\n".join(lines), False))

        if not fields:
            await interaction.response.send_message("📭 등록된 계획이 없어요! `/계획 등록` 명령어로 추가해보세요.", ephemeral=True)
            return

        rest_cnt = core.count_in_month(view.get('rest_history', []), display_date)
        exempt_cnt = core.count_in_month(view.get('exemptions', []), display_date)

        embeds = build_embeds(
            title=f"📋 {interaction.user.display_name}님의 계획표",
            color=discord.Color.blue(),
            fields=fields,
            footer=f"기준: {day_str(display_date)} {note_date} | 이번 달 휴식: {rest_cnt}회 / 면책: {exempt_cnt}회",
        )
        await respond_embeds(interaction, embeds)

async def setup(bot):
    await bot.add_cog(Plans(bot))
