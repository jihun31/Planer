"""인증: /인증, /인증취소와 자동완성"""
import traceback

import discord
from discord import app_commands
from discord.ext import commands

import core
import shared
from core import CATEGORY_KR, WEEKDAY_NAMES, day_str
from messages import build_embeds, fit_choice, respond_embeds
from shared import DATE_CHOICES, FINE_AMOUNT, LongText
from store import Store

#자동완성 (인증할 수 있는 계획만 보여줌). 선택 값은 계획 ID
async def plan_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    view = shared.store.view(interaction.user.id)
    target_date = core.resolve_target_date(getattr(interaction.namespace, "날짜", None))

    choices = []
    for category, plan in core.iter_plans(view):
        tag = core.autocomplete_tag(view, category, plan, target_date)
        if tag is None:
            continue
        photo_mark = "📸 " if plan.get('photo') else ""
        name = f"[{tag}] {photo_mark}{plan['content']}"
        if current.lower() in name.lower():
            choices.append(app_commands.Choice(name=fit_choice(name), value=plan['id']))
    return choices[:25]

#인증 처리
async def process_verification(interaction: discord.Interaction, 계획: str, 내용: str, 사진: discord.Attachment, is_yesterday: bool):
    store = shared.store
    # content_type이 비어 있는(None) 첨부 파일도 있어서 안전하게 확인
    if 사진 and not (사진.content_type or "").startswith("image/"):
        await interaction.response.send_message("❌ 사진 파일만 올릴 수 있어요!", ephemeral=True)
        return

    target_date = core.resolve_target_date("yesterday" if is_yesterday else "today")
    display_note = "(어제 늦은 인증😅)" if is_yesterday else ("(새벽🌙)" if core.is_dawn() else "")
    target_date_str = day_str(target_date)

    user_id = str(interaction.user.id)
    category, plan = Store.find_plan(store.view(user_id), 계획)

    # 1. 인증 전에 확인 (조건이 안 맞으면 아무것도 저장하지 않음)
    if not plan:
        await interaction.response.send_message("❌ 해당 계획을 찾을 수 없어요! 목록에서 선택해주세요.", ephemeral=True)
        return

    if target_date_str < plan.get('created_at', '2000-01-01'):
        await interaction.response.send_message(f"❌ **'{plan['content']}'**은(는) {plan['created_at']}에 등록한 계획이라 그 전 날짜는 인증할 수 없어요.", ephemeral=True)
        return

    if category == "Routine":
        target_weekday = WEEKDAY_NAMES[target_date.weekday()]
        if plan.get('days') and target_weekday not in plan['days']:
            await interaction.response.send_message(f"❌ **'{plan['content']}'**은(는) **{target_weekday}요일**에 하는 날이 아닙니다!", ephemeral=True)
            return

    if plan.get('photo') and not 사진:
        await interaction.response.send_message(f"📸 **'{plan['content']}'**은(는) 사진 인증이 필요한 계획이에요! `사진` 칸에 인증샷을 첨부해주세요.", ephemeral=True)
        return

    # 2. 인증 기록 (Firestore). 목표 계획은 같은 요청에서 달성 처리
    check_in_id = await store.add_check_in(plan, target_date_str, user_id)
    view = store.view(user_id)

    extra_fields = []
    if category == "OneTime":
        verified_plan_name = f"🏆 [목표달성] {plan['content']}"
        extra_fields.append(("🎉 목표 달성!", "달성한 목표는 계획 목록에서 자동으로 정리했어요.", False))
    elif category == "Limit":
        _, fresh = Store.find_plan(view, plan['id'])
        count, limit, period_kr = core.limit_status(fresh or plan, target_date)
        verified_plan_name = f"[제한] {plan['content']} ({period_kr} {count}/{limit}회)"
        if count > limit:
            extra_fields.append(("🚨 제한 초과!", f"{period_kr} {limit}회 제한을 넘었어요. 정산 때 **{FINE_AMOUNT:,}원** 벌금이에요!", False))
        elif count == limit:
            extra_fields.append(("⚠️ 한도 도달", f"{period_kr} {limit}회를 다 썼어요. 한 번 더 하면 벌금이에요!", False))
    else:
        verified_plan_name = f"[{CATEGORY_KR[category]}] {plan['content']}"

    # 3. 현재 진행 상황
    plan_text_list = []
    for cat, p in core.iter_plans(view):
        mark, text = core.plan_progress_line(view, cat, p, target_date)
        content_display = f"**{p['content']}**" if p['id'] == plan['id'] else p['content']
        plan_text_list.append(f"{mark} {text} {content_display}")

    fields = [
        ("방금 인증함", verified_plan_name, False),
        ("인증 기준일", f"{target_date_str} {display_note}", False),
    ]
    fields.extend(extra_fields)
    if 내용: fields.append(("코멘트", 내용, False))
    fields.append(("📅 현재 진행 상황", "\n".join(plan_text_list) if plan_text_list else "계획 없음", False))

    embeds = build_embeds(
        title="🔥 인증 현황",
        color=discord.Color.green(),
        fields=fields,
        image_url=사진.url if 사진 else None,
    )
    await respond_embeds(interaction, embeds)

    # 4. 인증 메시지 링크 저장 → 앱에서 눌러서 사진 검수
    try:
        message = await interaction.original_response()
        await store.set_check_in_message(check_in_id, message.jump_url)
    except Exception:
        traceback.print_exc()

#인증취소 (계획 하나의 기록 한 번만 되돌리기)
def find_cancelable(view, value, date_str):
    """그 날짜에 기록이 있는 계획(활성 계획 또는 그날 달성한 목표). 값은 계획 ID 또는 이름"""
    candidates = [p for _, p in core.iter_plans(view) if date_str in p.get('history', [])]
    candidates += [g for g in view.get('completed_goals', []) if g.get('completed_at') == date_str]
    for match in (lambda p: p['id'] == value, lambda p: p['content'] == value):
        for plan in candidates:
            if match(plan):
                return plan
    return None

async def cancel_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    view = shared.store.view(interaction.user.id)
    date_str = day_str(core.resolve_target_date(getattr(interaction.namespace, "날짜", None)))

    names = []
    for category, plan in core.iter_plans(view):
        n = plan.get('history', []).count(date_str)
        if n:
            names.append((f"[{CATEGORY_KR[category]}] {plan['content']}" + (f" ({n}회 기록)" if category == "Limit" else ""), plan['id']))
    for goal in view.get('completed_goals', []):
        if goal.get('completed_at') == date_str:
            names.append((f"[목표달성] {goal['content']}", goal['id']))

    return [app_commands.Choice(name=fit_choice(n), value=v) for n, v in names if current.lower() in n.lower()][:25]

class CheckIns(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    #계획 인증
    @app_commands.command(name="인증", description="한 내용을 인증하세요 (깜빡한 어제 인증은 날짜: 어제)")
    @app_commands.describe(계획="인증할 계획 선택", 내용="코멘트 (선택)", 사진="인증샷 (선택)", 날짜="오늘(기본) / 어제")
    @app_commands.choices(날짜=DATE_CHOICES)
    @app_commands.autocomplete(계획=plan_autocomplete)
    async def verify_study(self, interaction: discord.Interaction, 계획: str, 내용: LongText = None, 사진: discord.Attachment = None,
                           날짜: app_commands.Choice[str] = None):
        is_yesterday = bool(날짜 and 날짜.value == "yesterday")
        await process_verification(interaction, 계획, 내용, 사진, is_yesterday=is_yesterday)

    @app_commands.command(name="인증취소", description="잘못 누른 인증을 한 번 되돌립니다 (제한 계획은 기록 1회만 취소)")
    @app_commands.describe(계획="취소할 계획 선택", 날짜="오늘(기본) / 어제")
    @app_commands.choices(날짜=DATE_CHOICES)
    @app_commands.autocomplete(계획=cancel_autocomplete)
    async def cancel_verification(self, interaction: discord.Interaction, 계획: str, 날짜: app_commands.Choice[str] = None):
        store = shared.store
        user_id = str(interaction.user.id)
        date_str = day_str(core.resolve_target_date(날짜.value if 날짜 else None))

        plan = find_cancelable(store.view(user_id), 계획, date_str)
        if not plan or not await store.cancel_check_in(plan, date_str):
            await interaction.response.send_message(f"❓ **{date_str}** 날짜에 **'{계획}'** 인증 기록이 없어요.", ephemeral=True)
            return

        msg = f"↩️ **{date_str}** **'{plan['content']}'** 인증을 한 번 취소했어요."
        if plan.get('completed'):
            msg += " 목표를 다시 계획 목록에 넣었어요."
        _, fresh = Store.find_plan(store.view(user_id), plan['id'])
        remaining = (fresh or {}).get('history', []).count(date_str)
        if remaining:
            msg += f" (이 날짜에 아직 {remaining}회 기록이 남아 있어요)"
        await interaction.response.send_message(msg, ephemeral=True)

async def setup(bot):
    await bot.add_cog(CheckIns(bot))
