"""서버: 입장 인사, 서버 이름·아이콘과 멤버 이름 동기화, /칭찬"""
import random
import traceback

import discord
from discord import app_commands
from discord.ext import commands

import shared

PRAISES = [
    "오늘도 정말 멋져요! 😎",
    "포기하지 않는 모습이 정말 아름답습니다! ✨",
    "당신은 할 수 있어요! 아자아자! 🔥",
    "오늘 공부도 파이팅입니다! 📚",
    "숨만 쉬어도 멋진 당신... 최고야! 👍",
    "어제보다 오늘 더 성장했군요! 🌱",
    "당신의 끈기에 박수를 보냅니다! 👏👏",
    "힘든 순간도 결국 지나갈 거예요. 힘내세요! 🌈",
    "당신은 생각보다 훨씬 더 대단한 사람입니다! 💎"
]

async def sync_server_info(guild):
    """앱 상단에 보여줄 디스코드 서버 이름·아이콘 저장"""
    if guild is None:
        return
    try:
        await shared.store.set_server_info(guild.id, guild.name, guild.icon.url if guild.icon else None)
    except Exception:
        print("⚠️ 서버 정보 저장 실패:")
        traceback.print_exc()

class Community(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.first_ready_done = False

    def alert_guild(self):
        channel = self.bot.get_channel(shared.ALERT_CHANNEL)
        return channel.guild if channel else None

    @commands.Cog.listener()
    async def on_ready(self):
        # on_ready는 다시 연결될 때도 실행됨 → 처음 한 번만
        if self.first_ready_done:
            return
        self.first_ready_done = True

        guild = self.alert_guild()
        await sync_server_info(guild)
        # 이전 데이터에서 옮겨온 멤버는 이름이 비어 있으니, 서버 멤버 이름으로 채움
        if guild:
            for discord_id in list(shared.store.data["members"]):
                member = guild.get_member(int(discord_id)) if discord_id.isdigit() else None
                if member and not member.bot:
                    try:
                        await shared.store.ensure_member(member.id, member.display_name)
                    except Exception:
                        traceback.print_exc()

    @commands.Cog.listener()
    async def on_guild_update(self, before, after):
        if after == self.alert_guild() and (before.name != after.name or before.icon != after.icon):
            await sync_server_info(after)

    #입장
    @commands.Cog.listener()
    async def on_member_join(self, member):
        print(f'{member}님이 입장했습니다.')
        channel = self.bot.get_channel(shared.WELCOME_CHANNEL)
        if channel:
            await channel.send(f'{member.mention} <- 바보 등장!!!')

    #칭찬
    @app_commands.command(name="칭찬", description="무작위 칭찬 멘트로 자존감을 채워줍니다!")
    async def praise_me(self, interaction: discord.Interaction):
        await interaction.response.send_message(f"📢 **{interaction.user.display_name}**님, {random.choice(PRAISES)}")

async def setup(bot):
    await bot.add_cog(Community(bot))
