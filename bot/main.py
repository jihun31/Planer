"""
돈까스봇 시작 파일. Firestore에 연결하고 기능별 cog(cogs/)를 불러옵니다.
  shared.py   설정(.env)과 공용 상태(store, bot_state)
  messages.py 디스코드 글자 수 제한에 맞춘 메시지 도구
  cogs/       plans(계획) · checkins(인증) · offdays(휴식·면책) · settlement(정산·알림·백업) · account(연동·알림시간) · community(서버)
"""
import traceback

import discord
from discord import app_commands
from discord.ext import commands

import shared
from store import Store, make_clients

EXTENSIONS = (
    "cogs.plans", "cogs.checkins", "cogs.offdays", "cogs.settlement", "cogs.account", "cogs.community",
)

#명령어를 쓸 때마다 멤버 정보(디스코드 표시 이름)를 Firestore에 맞춰 둠 → 앱 멤버 탭에서 이름 표시
class TonkatsuTree(app_commands.CommandTree):
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if shared.store is not None and interaction.guild is not None and not interaction.user.bot:
            try:
                await shared.store.ensure_member(interaction.user.id, interaction.user.display_name)
            except Exception:
                traceback.print_exc()
        return True

    #명령어 오류 공통 처리 (권한 없음, DM 사용, 예상 못 한 오류)
    async def on_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        if isinstance(error, app_commands.MissingPermissions):
            msg = "❌ 관리자만 사용할 수 있는 명령어입니다!"
        elif isinstance(error, app_commands.NoPrivateMessage):
            msg = "❌ 이 명령어는 서버 채널에서만 사용할 수 있어요!"
        elif isinstance(error, app_commands.CheckFailure):
            msg = "❌ 이 명령어를 사용할 수 없어요."
        else:
            cmd_name = interaction.command.name if interaction.command else "알 수 없음"
            print(f"🚨 /{cmd_name} 명령어 실행 중 오류:")
            traceback.print_exception(type(error), error, error.__traceback__)
            msg = "⚠️ 명령어 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요."

        try:
            if interaction.response.is_done():
                await interaction.followup.send(msg, ephemeral=True)
            else:
                await interaction.response.send_message(msg, ephemeral=True)
        except discord.HTTPException:
            pass

class TonkatsuBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        # 슬래시 명령어만 쓰므로 message_content 권한은 필요 없음
        # members는 개발자 포털에서 "Server Members Intent"를 켜야 함
        intents.members = True
        super().__init__(command_prefix='!', intents=intents, tree_cls=TonkatsuTree)
        self.commands_synced = False

    async def setup_hook(self):
        sync_client, async_client = make_clients()
        shared.store = Store(sync_client, async_client)
        await shared.store.start()
        print(f"🔥 Firestore 연결 완료: 계획 {len(shared.store.data['plans'])}개, 멤버 {len(shared.store.data['members'])}명")
        shared.bot_state = await shared.load_state()
        for extension in EXTENSIONS:
            await self.load_extension(extension)

    async def on_ready(self):
        # on_ready는 연결이 끊겼다 다시 붙을 때도 실행됨 → 명령어 동기화는 처음 한 번만 (디스코드 요청 제한 방지)
        if not self.commands_synced:
            self.commands_synced = True
            try:
                synced = await self.tree.sync()
                print(f"🔁 슬래시 명령어 {len(synced)}개 동기화 완료")
            except discord.HTTPException as e:
                print(f"⚠️ 슬래시 명령어 동기화 실패: {e}")
        print(f'로그인 성공! {self.user} 봇이 준비되었습니다.')

bot = TonkatsuBot()

if __name__ == "__main__":
    bot.run(shared.TOKEN)
