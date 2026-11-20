"""휴식·면책: /휴식, /면책(투표 화면), /현황, 재시작 때 투표 버튼 복구"""
from datetime import datetime, timedelta

import discord
from discord import app_commands, ui
from discord.ext import commands

import core
import shared
from core import day_str
from messages import build_embeds, respond_embeds
from shared import LongText

class ImmunityView(ui.View):
    """
    면책 투표 버튼.
    total_members: 요청자를 포함한 투표 대상 인원 (요청자 제외 투표 가능 인원 = total_members - 1)
    eligible_voters: 투표할 수 있는 유저 ID 목록. None이면 누구나 가능 (예전에 만든 투표 호환용)
    """
    def __init__(self, message_id: int, target_id: int, target_dates: list, agreed_users: list, denied_users: list,
                 total_members: int, required_votes: int, eligible_voters: list = None):
        super().__init__(timeout=None)
        self.message_id = str(message_id)
        self.target_id = int(target_id)
        self.target_dates = [target_dates] if isinstance(target_dates, str) else list(target_dates)

        self.agreed_users = {int(u) for u in agreed_users}
        self.denied_users = {int(u) for u in denied_users}
        self.total_members = total_members
        self.required_votes = required_votes
        self.eligible_voters = {int(u) for u in eligible_voters} if eligible_voters is not None else None

        self.update_button_label()

    def max_possible_yes(self):
        # 남은 사람이 전부 찬성해도 받을 수 있는 최대 찬성 수
        return self.total_members - 1 - len(self.denied_users)

    def update_button_label(self):
        agree_btn = [x for x in self.children if x.custom_id == "vote_agree"][0]
        deny_btn = [x for x in self.children if x.custom_id == "vote_deny"][0]

        agree_btn.label = f"인정합니다 ({len(self.agreed_users)}/{self.required_votes})"
        deny_btn.label = f"반대합니다 ({len(self.denied_users)})"

        if len(self.agreed_users) >= self.required_votes:
            agree_btn.label = "면책 통과됨 🎉"
            agree_btn.style = discord.ButtonStyle.primary
            agree_btn.disabled = True
            deny_btn.disabled = True
        elif self.max_possible_yes() < self.required_votes:
            deny_btn.label = "면책 거절됨 ❌"
            deny_btn.style = discord.ButtonStyle.danger
            deny_btn.disabled = True
            agree_btn.disabled = True

    async def save_status(self):
        current = shared.store.data["votes"].get(self.message_id)
        if current is not None:
            await shared.store.set_vote(self.message_id, {**current, 'agreed_users': sorted(self.agreed_users),
                                                          'denied_users': sorted(self.denied_users)})

    async def finish_vote(self):
        if self.message_id in shared.store.data["votes"]:
            await shared.store.delete_vote(self.message_id)

    def vote_error(self, user_id, is_agree):
        """투표할 수 없으면 안내 문구, 가능하면 None"""
        if user_id == self.target_id:
            return "❌ 본인 사유에는 투표할 수 없어요!" if is_agree else "❌ 본인 사유에 반대할 수 없어요! (하고 싶으신가요..?)"
        if self.eligible_voters is not None and user_id not in self.eligible_voters:
            return "❌ 계획을 등록한 참가자만 투표할 수 있어요!"
        if user_id in self.agreed_users:
            return "이미 찬성하셨습니다." if is_agree else "이미 '찬성'표를 던지셨네요! 취소할 수 없습니다."
        if user_id in self.denied_users:
            return "이미 '반대'표를 던지셨네요! 취소할 수 없습니다." if is_agree else "이미 '반대'하셨습니다."
        return None

    @ui.button(label="인정합니다 (0/2)", style=discord.ButtonStyle.success, emoji="👌", custom_id="vote_agree")
    async def agree_button(self, interaction: discord.Interaction, button: ui.Button):
        user_id = interaction.user.id
        error = self.vote_error(user_id, is_agree=True)
        if error:
            await interaction.response.send_message(error, ephemeral=True)
            return

        self.agreed_users.add(user_id)
        await self.save_status()
        self.update_button_label()

        await interaction.channel.send(f"🙆‍♂️ <@{user_id}>님이 **찬성**했습니다!")

        if len(self.agreed_users) < self.required_votes:
            await interaction.response.edit_message(view=self)
            return

        # 통과: 면책 날짜 등록
        await shared.store.add_exemptions(self.target_id, self.target_dates)
        await self.finish_vote()

        if len(self.target_dates) > 1:
            period_str = f"{self.target_dates[0]} ~ {self.target_dates[-1]} ({len(self.target_dates)}일간)"
        else:
            period_str = self.target_dates[0]

        embed = interaction.message.embeds[0]
        embed.color = discord.Color.blue()
        embed.set_footer(text="")
        embed.add_field(name="최종 결과", value=f"✅ **{len(self.agreed_users)}표** 찬성으로 면책되었습니다!", inline=False)

        await interaction.response.edit_message(embed=embed, view=self)
        await interaction.followup.send(f"🛡️ <@{self.target_id}>님의 **{period_str}** 벌금이 면제되었습니다!")

    @ui.button(label="반대합니다", style=discord.ButtonStyle.secondary, emoji="🙅", custom_id="vote_deny")
    async def deny_button(self, interaction: discord.Interaction, button: ui.Button):
        user_id = interaction.user.id
        error = self.vote_error(user_id, is_agree=False)
        if error:
            await interaction.response.send_message(error, ephemeral=True)
            return

        self.denied_users.add(user_id)
        await self.save_status()
        self.update_button_label()

        await interaction.channel.send(f"🙅 <@{user_id}>님이 **반대**했습니다!")

        if self.max_possible_yes() >= self.required_votes:
            await interaction.response.edit_message(view=self)
            return

        # 거절: 남은 사람이 다 찬성해도 과반수가 안 됨
        await self.finish_vote()

        embed = interaction.message.embeds[0]
        embed.color = discord.Color.red()
        embed.set_footer(text="")
        embed.add_field(name="결과", value="❌ 반대가 너무 많아 **부결(거절)**되었습니다.", inline=False)

        await interaction.response.edit_message(embed=embed, view=self)
        await interaction.followup.send(f"🚫 <@{self.target_id}>님의 면책 요청이 **거절**되었습니다.")

def vote_view_from_doc(msg_id, data):
    """Firestore votes 문서로 투표 버튼 다시 만들기"""
    req_votes = data.get("required_votes", 2)
    dates = data["target_dates"] if "target_dates" in data else [data.get("date_str", "")]
    return ImmunityView(
        message_id=int(msg_id),
        target_id=int(data['target_id']),
        target_dates=dates,
        agreed_users=data.get('agreed_users', []),
        denied_users=data.get("denied_users", []),
        total_members=data.get("total_members", req_votes * 2),
        required_votes=req_votes,
        eligible_voters=data.get("eligible_voters"),  # 예전 투표는 없음 → 누구나 투표 가능
    )

def get_eligible_voters(guild, requester_id):
    """투표할 수 있는 사람: 서버에 있는 사람 중 계획을 하나라도 등록한 참가자 (요청자, 봇 제외)"""
    return [m.id for m in guild.members
            if not m.bot and m.id != requester_id and core.has_active_plans(shared.store.view(m.id))]

async def start_immunity_vote(interaction: discord.Interaction, dates: list, title: str, color: discord.Color, date_field: tuple, 사유: str):
    """면책 투표 메시지를 만들고 저장함 (하루/기간 면책 공통)"""
    requester_id = interaction.user.id
    voters = get_eligible_voters(interaction.guild, requester_id)

    if not voters:
        await interaction.response.send_message("❌ 투표해 줄 다른 참가자가 없어요! (계획을 등록한 다른 멤버가 있어야 해요)", ephemeral=True)
        return

    required_votes = len(voters) // 2 + 1  # 요청자를 뺀 참가자의 과반수

    embed = discord.Embed(title=title, description=f"**{interaction.user.display_name}**님이 면책을 요청했습니다.", color=color)
    embed.add_field(name=date_field[0], value=date_field[1], inline=False)
    embed.add_field(name="📝 사유", value=사유, inline=False)
    embed.set_footer(text=f"참가자 {len(voters)}명 중 과반수인 {required_votes}명의 동의가 필요합니다.")

    await interaction.response.send_message(content="@everyone", embed=embed)
    message = await interaction.original_response()

    view = ImmunityView(message.id, requester_id, dates, [], [], len(voters) + 1, required_votes, voters)
    await interaction.edit_original_response(view=view)

    # 재부팅 때 버튼을 복구할 수 있도록 저장 (앱에서도 진행 중인 투표를 볼 수 있음)
    await shared.store.set_vote(message.id, {
        "target_id": requester_id,
        "target_dates": dates,
        "reason": 사유,
        "agreed_users": [],
        "denied_users": [],
        "total_members": len(voters) + 1,
        "required_votes": required_votes,
        "eligible_voters": voters,
    })

class OffDays(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.votes_restored = False

    @commands.Cog.listener()
    async def on_ready(self):
        # on_ready는 다시 연결될 때도 실행됨 → 투표 버튼 복구는 처음 한 번만
        if self.votes_restored:
            return
        self.votes_restored = True
        for msg_id, data in list(shared.store.data["votes"].items()):
            try:
                self.bot.add_view(vote_view_from_doc(msg_id, data), message_id=int(msg_id))
            except Exception as e:
                print(f"⚠️ 투표 복구 실패 (ID: {msg_id}): {e}")

    # --- 면책 요청 ---
    @app_commands.command(name="면책", description="벌금 면제를 요청합니다. 날짜를 비우면 오늘 하루 (참가자 과반수 동의 필요)")
    @app_commands.describe(
        사유="면책을 요청하는 합당한 사유를 적어주세요.",
        시작일="기간 면책 시작일 YYYY-MM-DD (비우면 오늘)",
        종료일="기간 면책 종료일 YYYY-MM-DD (비우면 시작일 하루만)",
    )
    @app_commands.guild_only()
    async def request_immunity(self, interaction: discord.Interaction, 사유: LongText, 시작일: str = None, 종료일: str = None):
        try:
            # 새벽 0~4시에 요청하면 전날 기준 (인증/정산과 같은 기준)
            start_dt = datetime.strptime(시작일 or day_str(core.get_base_date()), "%Y-%m-%d")
            end_dt = datetime.strptime(종료일, "%Y-%m-%d") if 종료일 else start_dt
        except ValueError:
            await interaction.response.send_message("❌ 날짜 형식이 올바르지 않습니다! **YYYY-MM-DD** (예: 2026-01-22) 형식으로 적어주세요.", ephemeral=True)
            return

        if start_dt > end_dt:
            await interaction.response.send_message("❌ 종료일이 시작일보다 빠를 수 없습니다!", ephemeral=True)
            return

        days = (end_dt - start_dt).days + 1
        if days > 30:
            await interaction.response.send_message("❌ 면책 기간은 최대 30일까지만 요청할 수 있어요.", ephemeral=True)
            return

        date_list = [day_str(start_dt + timedelta(days=i)) for i in range(days)]
        if days == 1:
            await start_immunity_vote(interaction, date_list, "🛡️ 면책 요청합니다!", discord.Color.orange(), ("📅 날짜", date_list[0]), 사유)
        else:
            period_str = f"{date_list[0]} ~ {date_list[-1]} (**총 {days}일**)"
            await start_immunity_vote(interaction, date_list, "🛡️ 장기 면책 요청합니다!", discord.Color.purple(), ("📅 기간", period_str), 사유)

    #휴식 (월 1회)
    @app_commands.command(name="휴식", description="한 달에 한 번, 오늘을 휴식일로 지정합니다. (벌금 면제)")
    @app_commands.describe(동작="사용하기(기본) / 오늘 쓴 휴식권 취소하기")
    @app_commands.choices(동작=[
        app_commands.Choice(name="사용하기", value="use"),
        app_commands.Choice(name="취소하기 (오늘 쓴 휴식권 되돌리기)", value="cancel"),
    ])
    async def take_rest(self, interaction: discord.Interaction, 동작: app_commands.Choice[str] = None):
        store = shared.store
        user_id = str(interaction.user.id)
        target_date = core.get_base_date()  # 새벽 0~4시는 전날
        target_date_str = day_str(target_date)

        if 동작 and 동작.value == "cancel":
            if not await store.cancel_rest(user_id, target_date_str):
                await interaction.response.send_message(f"❓ **{target_date_str}** 날짜로 사용된 휴식권이 없는데요?", ephemeral=True)
                return
            await interaction.response.send_message(f"↩️ **{target_date_str}** 날짜의 휴식 사용을 취소했습니다! 다시 횟수가 복구되었어요.", ephemeral=True)
            return

        # 사용 (이번 달에 쓴 적 있으면 거절. 앱에서 쓴 휴식도 포함)
        if core.count_in_month(store.view(user_id).get('rest_history', []), target_date) > 0 \
                or not await store.add_rest(user_id, target_date_str):
            await interaction.response.send_message("❌ **이번 달 휴식권을 이미 사용하셨어요!** (월 1회 제한)", ephemeral=True)
            return

        note = "(새벽🌙)" if core.is_dawn() else ""
        embed = discord.Embed(title="🛌 휴식권 사용!", description=f"**{target_date_str}** {note}\n오늘은 푹 쉬세요! 벌금이 부과되지 않습니다.", color=discord.Color.purple())
        embed.set_footer(text="⚠️ 월 1회만 가능하니 신중하게 사용하세요! (잘못 썼다면 /휴식 동작:취소하기)")
        await interaction.response.send_message(embed=embed)

    #현황
    @app_commands.command(name="현황", description="이번 달 멤버들의 휴식 및 면책 사용 내역을 확인합니다.")
    @app_commands.guild_only()
    async def check_monthly_status(self, interaction: discord.Interaction):
        now = core.get_base_date()
        this_month_str = now.strftime('%Y-%m')

        def fmt_dates(dates):
            return ", ".join(f"**{d[8:]}일**" for d in dates) if dates else "없음"

        fields = []
        for member in (m for m in interaction.guild.members if not m.bot):
            data = shared.store.view(member.id)
            month_rests = sorted(d for d in data.get('rest_history', []) if d.startswith(this_month_str))
            pure_immunity = sorted(d for d in data.get('exemptions', []) if d.startswith(this_month_str) and d not in month_rests)
            if not month_rests and not pure_immunity:
                continue
            rest_txt = f"🛌 **휴식({len(month_rests)}회):** {fmt_dates(month_rests)}"
            imm_txt = f"🛡️ **면책({len(pure_immunity)}회):** {fmt_dates(pure_immunity)}"
            fields.append((f"👤 {member.display_name}", f"{rest_txt}\n{imm_txt}", False))

        description = "이번 달 휴식 및 면책 사용 기록입니다." if fields else "✨ 이번 달은 아직 휴식이나 면책을 쓴 사람이 없네요! 성실해요! 🔥"
        embeds = build_embeds(
            title=f"📊 {now.month}월 현황판",
            color=discord.Color.blurple(),
            description=description,
            fields=fields,
            footer=f"기준: {now.strftime('%Y년 %m월')}",
        )
        await respond_embeds(interaction, embeds)

async def setup(bot):
    await bot.add_cog(OffDays(bot))
