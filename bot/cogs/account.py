"""계정·설정: /연동 (Planer 앱 계정 연결), /알림시간"""
import re

import discord
from discord import app_commands
from discord.ext import commands

import core
import shared

LINK_CODE_PATTERN = re.compile(r"^[A-HJ-NP-Z2-9]{8}$")   # 앱이 만드는 8자리 코드 (헷갈리는 I, O, 0, 1 제외)
LINK_FAIL_LIMIT = 5                                      # 10분에 틀린 코드 5번까지
link_failures = {}

def link_blocked(user_id):
    now = core.get_now().timestamp()
    recent = [t for t in link_failures.get(user_id, []) if now - t < 600]
    link_failures[user_id] = recent
    return len(recent) >= LINK_FAIL_LIMIT

class Account(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    #알림 시간 설정
    @app_commands.command(name="알림시간", description="인증 검사 알림 시간 설정")
    @app_commands.describe(시간="0~23시")
    async def set_alert_time(self, interaction: discord.Interaction, 시간: app_commands.Range[int, 0, 23]):
        await shared.store.set_alert_hour(interaction.user.id, 시간)

        msg = f"⏰ 알림 설정 완료! 매일 **{시간}시**에 인증 여부를 검사할게요! 👀"
        if 시간 < core.DAY_START_HOUR:
            msg += f"\n💡 **참고:** 새벽(0~{core.DAY_START_HOUR - 1}시)은 **'어제 날짜'**의 기록을 검사합니다. (밤샘러를 위한 배려!)"
        await interaction.response.send_message(msg, ephemeral=True)

    #Planer 앱 계정 연동
    @app_commands.command(name="연동", description="Planer 앱과 연동합니다. 앱 설정에서 받은 코드를 입력하세요.")
    @app_commands.describe(코드="앱 설정 → 디스코드 연동에서 받은 8자리 코드 (비우면 연동 상태 확인)",
                           동작="연결하기(기본) / 연동 해제")
    @app_commands.choices(동작=[
        app_commands.Choice(name="연결하기", value="link"),
        app_commands.Choice(name="연동 해제", value="unlink"),
    ])
    @app_commands.guild_only()
    async def link_app(self, interaction: discord.Interaction, 코드: str = None, 동작: app_commands.Choice[str] = None):
        store = shared.store
        user_id = interaction.user.id

        if 동작 and 동작.value == "unlink":
            if await store.unlink_account(user_id):
                await interaction.response.send_message("🔌 Planer 앱 연동을 해제했어요. 앱에서는 더 이상 인증·멤버 정보가 보이지 않아요.", ephemeral=True)
            else:
                await interaction.response.send_message("❓ 연동된 Planer 앱 계정이 없어요.", ephemeral=True)
            return

        if not 코드:
            linked = bool((store.data["members"].get(str(user_id)) or {}).get("uid"))
            msg = ("✅ Planer 앱과 연동되어 있어요. 해제하려면 `/연동 동작:연동 해제`" if linked else
                   "🔗 아직 연동 전이에요. Planer 앱 → ⚙ 설정 → **디스코드 연동**에서 코드를 받아 `/연동 코드:XXXXXXXX`로 입력하세요.")
            await interaction.response.send_message(msg, ephemeral=True)
            return

        if link_blocked(user_id):
            await interaction.response.send_message("⏳ 코드를 너무 많이 틀렸어요. 10분 뒤에 다시 시도해주세요.", ephemeral=True)
            return

        code = 코드.strip().upper().replace("-", "").replace(" ", "")
        result = "invalid"
        if LINK_CODE_PATTERN.match(code):
            result, _ = await store.link_account(user_id, code)

        if result == "linked":
            link_failures.pop(user_id, None)
            await interaction.response.send_message(
                f"🎉 Planer 앱과 연동됐어요! 앱에서 **{interaction.guild.name}** 멤버들의 진행 상황을 볼 수 있고, 앱에서도 인증할 수 있어요.\n"
                "(사진이 필요한 계획은 지금처럼 디스코드에서 인증해주세요)", ephemeral=True)
            return

        link_failures.setdefault(user_id, []).append(core.get_now().timestamp())
        msg = ("⌛ 만든 지 10분이 지난 코드예요. 앱에서 새 코드를 받아주세요." if result == "expired"
               else "❌ 코드를 찾을 수 없어요. 앱에 보이는 8자리 코드를 그대로 입력했는지 확인해주세요.")
        await interaction.response.send_message(msg, ephemeral=True)

async def setup(bot):
    await bot.add_cog(Account(bot))
