import discord
import os
import json
import random
import calendar
import asyncio
from discord import ui, app_commands
from discord.ext import tasks, commands
from dotenv import load_dotenv
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

load_dotenv()
TOKEN = os.getenv('TOKEN')

#채널 아이디
TARGET_CHANNEL = 
ALERT_CHANNEL = 
TEST_CHANNEL = 
WELCOME_CHANNEL = 

WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.voice_states = True

bot = commands.Bot(command_prefix='!', intents=intents)

KST = ZoneInfo("Asia/Seoul")

def get_now():
    return datetime.now(KST)

data_lock = asyncio.Lock()
time_lock = asyncio.Lock()

#파일 관리
DATA_FILE = "study_plans.json"
def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding = "utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                print("⚠️ 계획 파일(study_plans.json)이 손상되어 빈 값으로 시작합니다.")
                return {} # 파일이 깨졌으면 빈 딕셔너리 반환
    return {}

async def save_data(data):
    async with data_lock: # 🔒 잠금
        def _write():
            with open(DATA_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        await bot.loop.run_in_executor(None, _write)

#공부 시간 관리
TIME_FILE = "study_times.json"
last_reset_date_str = ""

def load_time_data():
    global last_reset_date_str
    if os.path.exists(TIME_FILE):
        with open(TIME_FILE, "r", encoding="utf-8") as f:
            try:
                raw_data = json.load(f)
                
                # 구버전 데이터 호환 (날짜 키가 없으면 구버전으로 간주)
                if "users" not in raw_data:
                    return {int(k): v for k, v in raw_data.items()}
                
                # 신버전 데이터
                last_reset_date_str = raw_data.get("last_date", "")
                return {int(k): v for k, v in raw_data["users"].items()}
            except:
                return {}
    return {}

async def save_time_data(data):
    # 저장할 때는 날짜와 데이터를 묶어서 저장
    async with time_lock:
        def _write():
            payload = {
                "last_date": last_reset_date_str, # 현재 기억하고 있는 날짜
                "users": data
            }
            with open(TIME_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=4, ensure_ascii=False)
        await bot.loop.run_in_executor(None, _write)

async def try_reset_daily_study():
    global daily_study_times, last_reset_date_str
    
    # 1. '공부 기준 날짜' 계산 (아침 6시 이전이면 어제로 취급)
    now = get_now()
    adjusted_date = now - timedelta(hours=6) 
    current_study_date = adjusted_date.strftime('%Y-%m-%d')

    # 2. 날짜가 바뀌었는지 확인
    # (기록된 날짜가 없거나, 기록된 날짜보다 오늘 날짜가 더 미래라면 초기화)
    if last_reset_date_str != current_study_date:
        print(f"🔄 날짜 변경 감지! ({last_reset_date_str} -> {current_study_date}) 공부 시간을 초기화합니다.")
        
        daily_study_times.clear() # 메모리 비우기
        last_reset_date_str = current_study_date # 날짜 갱신
        
        await save_time_data(daily_study_times) # 파일에 새 날짜와 빈 데이터 저장
        return True # 초기화 했음
    
    return False # 초기화 안 함


#파일 관리 코드
SESSION_FILE = "active_sessions.json"
session_lock = asyncio.Lock()    

def load_session_data():
    if os.path.exists(SESSION_FILE):
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                # 저장된 시간(숫자)을 다시 날짜 객체로 변환
                # 키(user_id)는 정수형(int)으로 변환
                return {int(uid): datetime.fromtimestamp(ts, KST) for uid, ts in data.items()}
            except:
                return {}
    return {}

async def save_session_data(data):
    async with session_lock:
        def _write():
            # 날짜 객체는 JSON 저장 안 됨 -> timestamp(숫자)로 변환해서 저장
            serializable_data = {str(uid): dt.timestamp() for uid, dt in data.items()}
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump(serializable_data, f, indent=4)
        await bot.loop.run_in_executor(None, _write)

#투표 데이터 관리
VOTE_FILE = "active_votes.json"
vote_lock = asyncio.Lock()

def load_vote_data():
    if os.path.exists(VOTE_FILE):
        with open(VOTE_FILE, "r", encoding="utf-8") as f:
            try:
                # 키(message_id)는 문자열로 저장되므로, 읽을 때도 그대로 둠
                return json.load(f)
            except:
                return {}
    return {}

async def save_vote_data(data):
    async with vote_lock:
        def _write():
            with open(VOTE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        await bot.loop.run_in_executor(None, _write)

#계획
user_plans = load_data()

#공부 시간 측정
study_sessions = {}
daily_study_times = {}

#봇 준비 
@bot.event
async def on_ready():
    global daily_study_times, study_sessions
    await bot.tree.sync()
    
    daily_study_times = load_time_data()
    study_sessions = load_session_data()

    await try_reset_daily_study()
    
    print(f"📂 공부 시간 데이터 복구: {len(daily_study_times)}명")
    print(f"📂 진행 중인 세션 복구: {len(study_sessions)}명") # 복구 확인용 로그

    target_channel = bot.get_channel(TARGET_CHANNEL)

    if target_channel:
        # 현재 채널에 접속 중인 멤버 ID 목록 (봇 제외)
        current_member_ids = [m.id for m in target_channel.members if not m.bot]
        
        # A. [유령 퇴치] 파일엔 있는데, 실제 방엔 없는 사람 -> 강제 퇴장 처리
        ghost_users = []
        for user_id in list(study_sessions.keys()): # 리스트 복사해서 순회
            if user_id not in current_member_ids:
                ghost_users.append(user_id)
                
                # 강제 퇴장 처리 (지금까지 시간 저장)
                start_time = study_sessions.pop(user_id)
                duration = get_now() - start_time
                seconds = int(duration.total_seconds())
                
                daily_study_times[user_id] = daily_study_times.get(user_id, 0) + seconds
                print(f"👻 유령 세션 정리됨: ID {user_id} (+{seconds}초)")

        # B. [미아 등록] 실제 방엔 있는데, 파일엔 없는 사람 -> 입장 처리
        # (봇 꺼진 사이에 들어온 사람)
        new_users = 0
        for member_id in current_member_ids:
            if member_id not in study_sessions:
                study_sessions[member_id] = get_now()
                new_users += 1
                print(f"🧟 미등록 세션 복구됨: ID {member_id}")

        # 변경사항이 있으면 파일에 저장
        if ghost_users or new_users > 0:
            await save_session_data(study_sessions)
            await save_time_data(daily_study_times)
            print(f"✨ 정리 완료: 유령 {len(ghost_users)}명 퇴치, 미등록 {new_users}명 등록")
            
    else:
        print("⚠️ 경고: TARGET_CHANNEL을 찾을 수 없습니다. 유령 세션 정리를 건너뜁니다.")

    votes_data = load_vote_data()
    for msg_id, data in votes_data.items():
        try:
            # 저장된 과반수(required_votes)를 가져옴 (없으면 기본값 2)
            req_votes = data.get("required_votes", 2)
            tot_mem = data.get("total_members", req_votes * 2) 
            denied = data.get("denied_users", [])

            if "target_dates" in data:
                dates = data["target_dates"]
            else:
                # 구버전 데이터가 있다면 리스트로 변환
                dates = [data.get("date_str", "")]

            view = ImmunityView(
                message_id=int(msg_id),
                target_id=data['target_id'],
                target_dates=dates,
                agreed_users=data['agreed_users'],
                denied_users=denied,
                total_members=tot_mem,
                required_votes=req_votes
            )
            bot.add_view(view, message_id=int(msg_id))

        except Exception as e:
            print(f"⚠️ 투표 복구 실패 (ID: {msg_id}): {e}")

    if not check_study_status.is_running():
        check_study_status.start()

    print(f'로그인 성공! {bot.user} 봇이 준비되었습니다.')

#입장
@bot.event
async def on_member_join(member):

    print(f'{member}님이 입장했습니다.')
    channel = bot.get_channel(WELCOME_CHANNEL)

    if channel:
        await channel.send(f'{member.mention} <- 바보 등장!!!')

#계획 등록
plan_group = app_commands.Group(name="계획", description="나만의 계획을 세웁니다.")

#일일계획
@plan_group.command(name="일일", description="매일 반복할 계획을 세웁니다.")
@app_commands.describe(내용="내용", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=[
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
])

async def plan_daily(interaction: discord.Interaction, 내용:str, 사진인증:app_commands.Choice[int]):
    user_id = str(interaction.user.id)
    if user_id not in user_plans: user_plans[user_id] = {}

    if "Daily" not in  user_plans[user_id]:
        user_plans[user_id]["Daily"] = []
    
    for cat, plans in user_plans[user_id].items():
        if cat in ["alert_time", "fines", "exemptions", "rest_history"]: 
            continue
            
        if isinstance(plans, list): 
            for plan in plans:
                # 데이터가 딕셔너리(계획 형태)인지 한 번 더 안전하게 확인
                if isinstance(plan, dict) and plan.get('content') == 내용:
                    await interaction.response.send_message(f"✋ **'{내용}'** 계획은 이미 [{cat}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
                    return

    photoRequire = bool(사진인증.value)

    user_plans[user_id]["Daily"].append({
        "type": "매일",
        "content": 내용,
        "photo": photoRequire,
        "history": []
    })
    await save_data(user_plans)

    icon = "📸" if photoRequire else "📝"
    await interaction.response.send_message(f"📅 **[일일] 계획 등록 완료!**\n- **내용:** {내용}")
#주간계획
@plan_group.command(name="주간", description="주간 계획을 세웁니다.")
@app_commands.describe(횟수="주N회", 내용="내용", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=[
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
])

async def plan_weekly(interaction: discord.Interaction, 횟수:int, 내용:str, 사진인증:app_commands.Choice[int]):
    user_id = str(interaction.user.id)
    if user_id not in user_plans: user_plans[user_id] = {}

    if "Weekly" not in  user_plans[user_id]:
        user_plans[user_id]["Weekly"] = []

    for cat, plans in user_plans[user_id].items():
        if cat in ["alert_time", "fines", "exemptions", "rest_history"]: 
            continue
            
        if isinstance(plans, list): 
            for plan in plans:
                # 데이터가 딕셔너리(계획 형태)인지 한 번 더 안전하게 확인
                if isinstance(plan, dict) and plan.get('content') == 내용:
                    await interaction.response.send_message(f"✋ **'{내용}'** 계획은 이미 [{cat}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
                    return

    photoRequire = bool(사진인증.value)

    user_plans[user_id]["Weekly"].append({
        "type": "주간",
        "count": 횟수,
        "content": 내용,
        "photo": photoRequire,
        "history": []
    })
    await save_data(user_plans)

    icon = "📸" if photoRequire else "📝"
    await interaction.response.send_message(f"📅 **[주간] 계획 등록 완료!**\n- **목표:** 주 {횟수}회\n- **내용:** {내용}")
#월간계획
@plan_group.command(name="월간", description="월간 계획을 세웁니다.")
@app_commands.describe(횟수="월N회", 내용="내용", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=[
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
])

async def plan_monthly(interaction: discord.Interaction, 횟수:int, 내용:str, 사진인증:app_commands.Choice[int]):
    user_id = str(interaction.user.id)
    if user_id not in user_plans: user_plans[user_id] = {}

    if "Monthly" not in  user_plans[user_id]:
        user_plans[user_id]["Monthly"] = []

    for cat, plans in user_plans[user_id].items():
        if cat in ["alert_time", "fines", "exemptions", "rest_history"]: 
            continue
            
        if isinstance(plans, list): 
            for plan in plans:
                # 데이터가 딕셔너리(계획 형태)인지 한 번 더 안전하게 확인
                if isinstance(plan, dict) and plan.get('content') == 내용:
                    await interaction.response.send_message(f"✋ **'{내용}'** 계획은 이미 [{cat}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
                    return

    photoRequire = bool(사진인증.value)

    user_plans[user_id]["Monthly"].append({
        "type": "월간",
        "count": 횟수,
        "content": 내용,
        "photo": photoRequire,
        "history": []
    })
    await save_data(user_plans)

    icon = "📸" if photoRequire else "📝"       
    await interaction.response.send_message(f"📅 **[월간] 계획 등록 완료!**\n- **목표:** 월 {횟수}회\n- **내용:** {내용}")

#n일계획
@plan_group.command(name="n일", description="N일마다 반복하는 계획을 세웁니다")
@app_commands.describe(간격="며칠마다 할까요? (숫자)", 내용="내용", 사진인증="인증 방식")
@app_commands.choices(사진인증=[
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
])
async def plan_interval(interaction: discord.Interaction, 간격: int, 내용: str, 사진인증: app_commands.Choice[int]):
    user_id = str(interaction.user.id)
    if user_id not in user_plans: user_plans[user_id] = {}

    if "Interval" not in user_plans[user_id]:
        user_plans[user_id]["Interval"] = []

    for cat, plans in user_plans[user_id].items():
        if cat in ["alert_time", "fines", "exemptions", "rest_history"]: 
            continue
            
        if isinstance(plans, list): 
            for plan in plans:
                # 데이터가 딕셔너리(계획 형태)인지 한 번 더 안전하게 확인
                if isinstance(plan, dict) and plan.get('content') == 내용:
                    await interaction.response.send_message(f"✋ **'{내용}'** 계획은 이미 [{cat}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
                    return

    photoRequire = bool(사진인증.value)

    user_plans[user_id]["Interval"].append({
        "type": "N일",
        "interval": 간격,
        "content": 내용,
        "photo": photoRequire,
        "history": []
    })
    await save_data(user_plans)

    icon = "📸" if photoRequire else "📝"
    await interaction.response.send_message(f"📅 **[{간격}일마다] 계획 등록!** ({icon})\n- **내용:** {내용}")

#일회성 목표
@plan_group.command(name="목표", description="특정 날짜까지 완수해야 하는 1회성 목표를 세웁니다.")
@app_commands.describe(마감일="YYYY-MM-DD 형식 (예: 2026-01-20)", 내용="목표 내용", 사진인증="인증 방식")
@app_commands.choices(사진인증=[
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
])
async def plan_deadline(interaction: discord.Interaction, 마감일: str, 내용: str, 사진인증: app_commands.Choice[int]):
    user_id = str(interaction.user.id)

    try:
        datetime.strptime(마감일, "%Y-%m-%d")
    except ValueError:
        await interaction.response.send_message("❌ 날짜 형식이 틀렸어요! **2026-01-20** 처럼 적어주세요.", ephemeral=True)
        return

    if user_id not in user_plans: user_plans[user_id] = {}
    if "OneTime" not in user_plans[user_id]: user_plans[user_id]["OneTime"] = []

    for cat, plans in user_plans[user_id].items():
        if cat in ["alert_time", "fines", "exemptions", "rest_history"]: 
            continue
            
        if isinstance(plans, list): 
            for plan in plans:
                # 데이터가 딕셔너리(계획 형태)인지 한 번 더 안전하게 확인
                if isinstance(plan, dict) and plan.get('content') == 내용:
                    await interaction.response.send_message(f"✋ **'{내용}'** 계획은 이미 [{cat}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
                    return

    photoRequire = bool(사진인증.value)

    user_plans[user_id]["OneTime"].append({
        "type": "목표",
        "deadline": 마감일,
        "content": 내용,
        "photo": photoRequire,
        "completed": False, # 완료 여부 체크
        "history": []
    })
    await save_data(user_plans)

    icon = "📸" if photoRequire else "📝"
    await interaction.response.send_message(f"🎯 **[목표] 등록 완료!**\n- **마감:** {마감일}까지\n- **내용:** {내용} {icon}")

# --- 요일 계획 등록 명령어 ---
@plan_group.command(name="요일", description="특정 요일에만 반복할 계획을 세웁니다.")
@app_commands.describe(내용="내용", 요일="예: 월수금, 토일 (원하는 요일을 붙여서 적으세요)", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=[
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
])
async def plan_routine(interaction: discord.Interaction, 내용:str, 요일:str, 사진인증:app_commands.Choice[int]):
    user_id = str(interaction.user.id)
    if user_id not in user_plans: user_plans[user_id] = {}
    if "Routine" not in user_plans[user_id]: user_plans[user_id]["Routine"] = []

    # 1. 중복 계획 검사
    for cat, plans in user_plans[user_id].items():
        if cat in ["alert_time", "fines", "exemptions", "rest_history"]: 
            continue
            
        if isinstance(plans, list): 
            for plan in plans:
                # 데이터가 딕셔너리(계획 형태)인지 한 번 더 안전하게 확인
                if isinstance(plan, dict) and plan.get('content') == 내용:
                    await interaction.response.send_message(f"✋ **'{내용}'** 계획은 이미 [{cat}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
                    return

    # 2. [핵심] 입력한 글자에서 요일만 쏙쏙 뽑아내기!
    selected_days = []
    for day in WEEKDAY_NAMES: # ["월", "화", "수", "목", "금", "토", "일"]
        if day in 요일:
            selected_days.append(day)
            
    # 요일을 하나도 못 찾았을 경우 튕겨내기
    if not selected_days:
        await interaction.response.send_message("❌ 요일을 제대로 인식하지 못했어요! **'월수금'**, **'토일'** 처럼 요일 글자를 포함해서 적어주세요.", ephemeral=True)
        return

    photoRequire = bool(사진인증.value)

    today_str = get_now().strftime('%Y-%m-%d')

    # 3. 데이터 저장
    user_plans[user_id]["Routine"].append({
        "type": "요일",
        "content": 내용,
        "photo": photoRequire,
        "days": selected_days, 
        "history": [],
        "created_at": today_str
    })
    await save_data(user_plans)

    days_str = ", ".join(selected_days)
    await interaction.response.send_message(f"✅ **[요일] 계획 등록 완료!**\n- **내용:** {내용}\n- **수행 요일:** {days_str}요일")

#계획 전체 삭제(초기화)
@plan_group.command(name="초기화", description="등록된 계획을 삭제합니다.")
@app_commands.describe(유형="어떤 계획을 비울까요?")
@app_commands.choices(유형=[
    app_commands.Choice(name="일일 계획 전체 삭제", value="Daily"),
    app_commands.Choice(name="요일 계획 전체 삭제", value="Routine"),
    app_commands.Choice(name="주간 계획 전체 삭제", value="Weekly"),
    app_commands.Choice(name="월간 계획 전체 삭제", value="Monthly"),
    app_commands.Choice(name="N일(반복) 계획 전체 삭제", value="Interval"),
    app_commands.Choice(name="목표(1회성) 전체 삭제", value="OneTime"),
    app_commands.Choice(name="모든 계획 삭제", value="All")
])
async def plan_reset(interaction: discord.Interaction, 유형: app_commands.Choice[str]):
    user_id = str(interaction.user.id)
    target = 유형.value

    if user_id not in user_plans:
        await interaction.response.send_message("❌ 삭제할 계획이 없어요!", ephemeral=True)
        return 
    
    if target == "All":
        # 계획 카테고리만 골라서 지웁니다.
        categories_to_delete = ["Daily", "Routine", "Weekly", "Monthly", "Interval", "OneTime"]
        deleted_count = 0
        
        for cat in categories_to_delete:
            if cat in user_plans[user_id]:
                del user_plans[user_id][cat]
                deleted_count += 1
        
        if deleted_count > 0:
            await save_data(user_plans)
            await interaction.response.send_message("🗑️ **모든 계획**을 비웠습니다! (벌금과 설정은 유지됩니다)", ephemeral=True)
        else:
            await interaction.response.send_message("❓ 삭제할 계획이 없어요.", ephemeral=True)
    
    elif target in user_plans[user_id]:
        del user_plans[user_id][target]
        await save_data(user_plans)
        await interaction.response.send_message(f"🗑️ **{유형.name}** 항목을 모두 비웠습니다.", ephemeral=True)
    else:
        await interaction.response.send_message(f"❓ **{유형.name}**은 등록된 게 없네요.", ephemeral=True)

#자동완성
async def plan_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    user_id = str(interaction.user.id)
    choices = []

    if user_id in user_plans:

        now = get_now()
        current_hour = now.hour
        
        if 0 <= current_hour < 6:
            base_date = now - timedelta(days=1)
        else:
            base_date = now
        
        cmd_name = interaction.command.name if interaction.command else "인증"
        
        if cmd_name == "어제인증":
            target_date = base_date - timedelta(days=1)
        else:
            target_date = base_date
        
        target_date_str = target_date.strftime('%Y-%m-%d')
        
        # 주간/월간 계산용
        start_of_week = target_date - timedelta(days=target_date.weekday())
        start_of_week_str = start_of_week.strftime('%Y-%m-%d')
        next_week_start_str = (start_of_week + timedelta(days=7)).strftime('%Y-%m-%d')
        this_month_str = target_date.strftime('%Y-%m')

        for category, plans in user_plans[user_id].items():
            if category in ["alert_time", "fines", "exemptions", "rest_history"]: continue
            if not isinstance(plans, list): continue

            for plan in plans:
                if isinstance(plan, str): continue

                is_completed = False

                history = plan.get('history', [])
                if target_date_str in history: continue
                
                tag = category

                if category == "Daily":
                    tag = "일일"
                    if target_date_str in history:
                        is_completed = True

                elif category == "Routine":
                    tag = "요일"
                    target_weekday = WEEKDAY_NAMES[target_date.weekday()]
                    plan_days = plan.get('days', [])
                    
                    # 지정된 요일이 있고, 오늘(어제)이 그 요일이 아니면 목록에서 제외
                    if plan_days and target_weekday not in plan_days:
                        continue
                        
                    if target_date_str in history:
                        is_completed = True

                elif category == "Weekly":
                    final_target = get_weekly_target(user_id, plan, target_date)
                    tag = f"주{final_target}회"
                    
                    current_count = 0
                    for h in history:
                        if start_of_week_str <= h < next_week_start_str:
                            current_count += 1

                    if current_count >= final_target: continue

                elif category == "Monthly":
                    tag = "월간"
                    current_count = sum(1 for d in history if d.startswith(this_month_str))
                    target_count = plan.get('count', 1)
                    if current_count >= target_count: is_completed = True

                elif category == "Interval":
                    interval = plan.get('interval', 1)
                    last_date = history[-1] if history else ""

                    curr_dt = datetime.strptime(target_date_str, "%Y-%m-%d")
                    
                    if last_date:
                        last_dt = datetime.strptime(last_date, "%Y-%m-%d")
                        diff = (curr_dt - last_dt).days

                        # 아직 기간이 안 찼으면 (D-1) 형태로 표시
                        if diff < interval:
                            tag = f"{interval}일장/D-{interval-diff}"
                        # 👇 [추가된 부분] 오늘이 딱 마감일일 때
                        elif diff == interval:
                            tag = f"{interval}일장/오늘마감"
                        else:
                            # 기간이 지났으면 (D+1) 형태로 표시 (급함!)
                            tag = f"{interval}일장/D+{diff-interval}"
                    else:
                        tag = f"{interval}일장/시작전"

                elif category == "OneTime": 
                    # 이미 완료된 건 추천에 안 띄우기
                    if plan.get('completed', False): 
                        is_completed = True
                    else:
                        tag = f"~{plan.get('deadline', '날짜미정')}"

                if is_completed: continue
                
                name = f"[{tag}] {plan['content']}"
                if current.lower() in name.lower():
                        choices.append(app_commands.Choice(name=name, value=plan['content']))

    return choices[:25]

#자동완성(삭제)
async def plan_autocomplete_delete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    user_id = str(interaction.user.id)
    choices = []

    if user_id in user_plans:
        for category, plans in user_plans[user_id].items():

            if category in ["alert_time", "fines", "exemptions", "rest_history"]: continue
            if not isinstance(plans, list): continue

            for plan in plans:
                if isinstance(plan, str): continue # 안전장치

                tag = category
                if category == "Daily": tag = "일일"
                elif category == "Routine": tag = "요일"
                elif category == "Weekly": tag = f"주{plan.get('count', 1)}회"
                elif category == "Monthly": tag = "월간"
                elif category == "Interval": tag = f"{plan.get('interval', 1)}일장"
                elif category == "OneTime": tag = "목표"

                name = f"[{tag}] {plan['content']}"
                
                # 검색 필터
                if current.lower() in name.lower():
                    choices.append(app_commands.Choice(name=name, value=plan['content']))

    return choices[:25]

#계획 삭제
@plan_group.command(name="삭제", description="등록된 계획 중 하나를 선택해 삭제합니다.")
@app_commands.describe(계획="삭제할 계획을 선택하세요?")
@app_commands.autocomplete(계획=plan_autocomplete_delete)

async def plan_delete(interaction: discord.Interaction, 계획: str):
    user_id = str(interaction.user.id)
    
    if user_id not in user_plans:
        await interaction.response.send_message("❌ 등록된 계획이 하나도 없어요!", ephemeral=True)
        return

    deleted_plan_info = ""
    cats_to_check = []

    for category, plans in user_plans[user_id].items():
        if category in ["alert_time", "fines", "exemptions", "rest_history"]: continue
        if not isinstance(plans, list): continue

        for index, plan in enumerate(plans):
            if isinstance(plan, dict) and plan.get('content') == 계획:
                plans.pop(index)
                cats_to_check.append(category) # 나중에 비었는지 확인
                
                cat_name = "기타"
                if category == "Daily": cat_name = "일일"
                elif category == "Routine": cat_name = "요일"
                elif category == "Weekly": cat_name = "주간"
                elif category == "Monthly": cat_name = "월간"
                elif category == "Interval": cat_name = "반복"
                elif category == "OneTime": cat_name = "목표"
                
                deleted_plan_info = f"[{cat_name}] {계획}"
                break 
        
        if deleted_plan_info: break

    for cat in cats_to_check:
        if not user_plans[user_id][cat]:
            del user_plans[user_id][cat]

    if deleted_plan_info:
        await save_data(user_plans) # 저장 필수
        await interaction.response.send_message(f"🗑️ **{deleted_plan_info}** 계획을 시원하게 삭제했습니다! 👋")
    else:
        await interaction.response.send_message(f"❓ **'{계획}'**라는 계획을 못 찾겠어요. 이미 삭제됐나 봐요!", ephemeral=True)

bot.tree.add_command(plan_group)

# --- 면책 ---
class ImmunityView(ui.View):
    def __init__(self, message_id: int, target_id: int, target_dates: list, agreed_users: list, denied_users: list, total_members: int, required_votes: int):
        super().__init__(timeout=None)
        self.message_id = str(message_id)
        self.target_id = target_id

        if isinstance(target_dates, str):
            self.target_dates = [target_dates]
        else:
            self.target_dates = target_dates
        
        self.agreed_users = set(agreed_users) # 찬성 명단
        self.denied_users = set(denied_users) # 반대 명단 (추가됨)
        self.total_members = total_members    # 전체 인원 (계산용)
        self.required_votes = required_votes

        self.update_button_label()
    
    def update_button_label(self):
        # 첫 번째 버튼(찬성) 찾기
        agree_btn = [x for x in self.children if x.custom_id == "vote_agree"][0]
        deny_btn = [x for x in self.children if x.custom_id == "vote_deny"][0]

        agree_count = len(self.agreed_users)
        deny_count = len(self.denied_users)

        agree_btn.label = f"인정합니다 ({agree_count}/{self.required_votes})"
        deny_btn.label = f"반대합니다 ({deny_count})"
        
        max_possible_yes = self.total_members - 1 - deny_count

        if agree_count >= self.required_votes:
            agree_btn.label = "면책 통과됨 🎉"
            agree_btn.style = discord.ButtonStyle.primary
            agree_btn.disabled = True
            deny_btn.disabled = True

        elif max_possible_yes < self.required_votes:
            deny_btn.label = "면책 거절됨 ❌"
            deny_btn.style = discord.ButtonStyle.danger
            deny_btn.disabled = True
            agree_btn.disabled = True

    async def save_status(self):
        votes_data = load_vote_data()
        if self.message_id in votes_data:
            votes_data[self.message_id]['agreed_users'] = list(self.agreed_users)
            votes_data[self.message_id]['denied_users'] = list(self.denied_users)
            await save_vote_data(votes_data)

    @ui.button(label="인정합니다 (0/2)", style=discord.ButtonStyle.success, emoji="👌", custom_id="vote_agree")
    async def agree_button(self, interaction: discord.Interaction, button: ui.Button):
        user_id = interaction.user.id
        
        # 본인 투표 금지
        if user_id == self.target_id:
            await interaction.response.send_message("❌ 본인 사유에는 투표할 수 없어요!", ephemeral=True)
            return
        
        # 이미 투표했는지 확인
        if user_id in self.agreed_users:
            await interaction.response.send_message("이미 찬성하셨습니다.", ephemeral=True)
            return
        
        if user_id in self.denied_users:
            await interaction.response.send_message("이미 '반대'표를 던지셨네요! 취소할 수 없습니다.", ephemeral=True)
            return

        self.agreed_users.add(user_id)
        await self.save_status()
        self.update_button_label()

        await interaction.channel.send(f"🙆‍♂️ <@{user_id}>님이 **찬성**했습니다!")
        
        if len(self.agreed_users) >= self.required_votes:
            user_id_str = str(self.target_id)
            if user_id_str not in user_plans: user_plans[user_id_str] = {}
            if 'exemptions' not in user_plans[user_id_str]: user_plans[user_id_str]['exemptions'] = []
            
            added_count = 0
            for d_str in self.target_dates:
                if d_str not in user_plans[user_id_str]['exemptions']:
                    user_plans[user_id_str]['exemptions'].append(d_str)
                    added_count += 1
            
            if added_count > 0: await save_data(user_plans)

            votes_data = load_vote_data()
            if self.message_id in votes_data:
                del votes_data[self.message_id]
                await save_vote_data(votes_data)

            embed = interaction.message.embeds[0]
            embed.color = discord.Color.blue()

            embed.set_footer(text="")
            #embed.clear_fields()
            
            if len(self.target_dates) > 1:
                period_str = f"{self.target_dates[0]} ~ {self.target_dates[-1]} ({len(self.target_dates)}일간)"
            else:
                period_str = self.target_dates[0]

            embed.add_field(name="최종 결과", value=f"✅ **{len(self.agreed_users)}표** 찬성으로 면책되었습니다!", inline=False)
            
            await interaction.response.edit_message(embed=embed, view=self)
            await interaction.followup.send(f"🛡️ <@{self.target_id}>님의 **{period_str}** 벌금이 면제되었습니다!")
        else:
            await interaction.response.edit_message(view=self)

    @ui.button(label="반대합니다", style=discord.ButtonStyle.secondary, emoji="🙅", custom_id="vote_deny")
    async def deny_button(self, interaction: discord.Interaction, button: ui.Button):
        user_id = interaction.user.id

        if user_id == self.target_id:
            await interaction.response.send_message("❌ 본인 사유에 반대할 수 없어요! (하고 싶으신가요..?)", ephemeral=True)
            return
            
        if user_id in self.denied_users:
            await interaction.response.send_message("이미 '반대'하셨습니다.", ephemeral=True)
            return
            
        if user_id in self.agreed_users:
            await interaction.response.send_message("이미 '찬성'표를 던지셨네요! 취소할 수 없습니다.", ephemeral=True)
            return

        self.denied_users.add(user_id)
        await self.save_status()
        self.update_button_label()

        await interaction.channel.send(f"🙅 <@{user_id}>님이 **반대**했습니다!")
        
        max_possible_yes = self.total_members - 1 - len(self.denied_users)
        #거절
        if max_possible_yes < self.required_votes:
            votes_data = load_vote_data()
            if self.message_id in votes_data:
                del votes_data[self.message_id]
                await save_vote_data(votes_data)

            embed = interaction.message.embeds[0]
            embed.color = discord.Color.red()
            embed.set_footer(text="")

            #embed.clear_fields()
            embed.add_field(name="결과", value=f"❌ 반대가 너무 많아 **부결(거절)**되었습니다.", inline=False)

            await interaction.response.edit_message(embed=embed, view=self)
            await interaction.followup.send(f"🚫 <@{self.target_id}>님의 면책 요청이 **거절**되었습니다.")
        else:
            await interaction.response.edit_message(view=self)
       
# --- 면책 요청 ---
@bot.tree.command(name="면책", description="개인 사정으로 인한 벌금 면제를 요청합니다 (2인 동의 필요).")
@app_commands.describe(사유="면책을 요청하는 합당한 사유를 적어주세요.")
async def request_immunity(interaction: discord.Interaction, 사유: str):
    user_id_int = interaction.user.id      # 뷰(View) 전달용 (숫자)
    user_id_str = str(interaction.user.id) # 데이터 키(Key)용 (문자열)
    
    # 1. 과반수 계산 (봇 제외)
    members = [m for m in interaction.guild.members if not m.bot]
    total_human = len(members)

    # 과반수(최소 2표)
    required_votes = max(2, (total_human // 2) + 1)

    # 데이터 초기화 (없으면 생성)
    if user_id_str not in user_plans: user_plans[user_id_str] = {}
    
    # 오늘 날짜
    now_kst = get_now()
    today_str = now_kst.strftime('%Y-%m-%d')
    
    # 임베드 생성
    embed = discord.Embed(title="🛡️ 면책 요청합니다!", description=f"**{interaction.user.display_name}**님이 개인 사정으로 면책을 요청했습니다.", color=discord.Color.orange())
    embed.add_field(name="📅 날짜", value=today_str, inline=True)
    embed.add_field(name="📝 사유", value=사유, inline=False)
    embed.set_footer(text=f"현재 인원 {total_human}명 중 과반수인 {required_votes}명의 동의가 필요합니다.")
    
    await interaction.response.send_message(content="@everyone", embed=embed)
    message = await interaction.original_response()

    # 2. 뷰 생성 (계산된 required_votes 전달)
    target_dates_list = [today_str]
    view = ImmunityView(message.id, user_id_int, target_dates_list, [], [], total_human, required_votes)

    await interaction.edit_original_response(view=view)

    # 3. 파일 저장 (목표 표수도 같이 저장해야 재부팅 때 기억함!)
    votes_data = load_vote_data()
    votes_data[str(message.id)] = {
        "target_id": user_id_int,
        "target_dates": target_dates_list,
        "agreed_users": [],
        "denied_users": [],
        "total_members": total_human,
        "required_votes": required_votes
    }
    await save_vote_data(votes_data)

#---면책기간---
@bot.tree.command(name="면책기간", description="특정 기간 동안의 벌금 면제를 요청합니다.")
@app_commands.describe(시작일="YYYY-MM-DD", 종료일="YYYY-MM-DD", 사유="면책 사유")
async def request_immunity_period(interaction: discord.Interaction, 시작일: str, 종료일: str, 사유: str):
    user_id_int = interaction.user.id
    user_id_str = str(interaction.user.id)

    # 1. 날짜 형식 및 유효성 검사
    try:
        start_dt = datetime.strptime(시작일, "%Y-%m-%d")
        end_dt = datetime.strptime(종료일, "%Y-%m-%d")
    except ValueError:
        await interaction.response.send_message("❌ 날짜 형식이 올바르지 않습니다! **YYYY-MM-DD** (예: 2026-01-22) 형식으로 적어주세요.", ephemeral=True)
        return

    if start_dt > end_dt:
        await interaction.response.send_message("❌ 종료일이 시작일보다 빠를 수 없습니다!", ephemeral=True)
        return

    # 2. 날짜 리스트 생성 (시작일 ~ 종료일)
    date_list = []
    curr = start_dt
    while curr <= end_dt:
        date_list.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)
        
    # (선택사항) 너무 긴 기간 방지 (예: 30일 이상 금지)
    if len(date_list) > 30:
         await interaction.response.send_message("❌ 면책 기간은 최대 30일까지만 요청할 수 있어요.", ephemeral=True)
         return

    # 3. 과반수 계산
    members = [m for m in interaction.guild.members if not m.bot]
    total_human = len(members) # 👈 전체 인원
    required_votes = max(2, (total_human // 2) + 1)

    if user_id_str not in user_plans: user_plans[user_id_str] = {}

    # 4. 임베드 생성
    period_str = f"{시작일} ~ {종료일} (**총 {len(date_list)}일**)"
    
    embed = discord.Embed(title="🛡️ 장기 면책 요청합니다!", description=f"**{interaction.user.display_name}**님이 **기간 면책**을 요청했습니다.", color=discord.Color.purple())
    embed.add_field(name="📅 기간", value=period_str, inline=False)
    embed.add_field(name="📝 사유", value=사유, inline=False)
    embed.set_footer(text=f"과반수({required_votes}명) 동의 필요")

    await interaction.response.send_message(content="@everyone", embed=embed)
    message = await interaction.original_response()

    # 5. 뷰 연결 (리스트 전달)
    view = ImmunityView(message.id, user_id_int, date_list, [], [], total_human, required_votes)
    await interaction.edit_original_response(view=view)

    # 6. 파일 저장
    votes_data = load_vote_data()
    votes_data[str(message.id)] = {
        "target_id": user_id_int,
        "target_dates": date_list,
        "agreed_users": [],
        "denied_users": [], 
        "total_members": total_human,
        "required_votes": required_votes
    }
    await save_vote_data(votes_data)

#휴식 (월 1회)
@bot.tree.command(name="휴식", description="한 달에 한 번, 오늘을 휴식일로 지정합니다. (벌금 면제)")
async def take_rest(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    
    if user_id not in user_plans:
        user_plans[user_id] = {}

    # 1. 날짜 계산
    now = get_now()
    if 0 <= now.hour < 6:
        target_date = now - timedelta(days=1)
        note = "(새벽🌙)"
    else:
        target_date = now
        note = ""

    target_date_str = target_date.strftime('%Y-%m-%d')
    current_month_str = target_date.strftime('%Y-%m')

    # 2. 휴식 사용 기록 확인
    if 'rest_history' not in user_plans[user_id]:
        user_plans[user_id]['rest_history'] = []
    
    # 이번 달에 쓴 적 있는지 확인
    has_used = False
    for date_str in user_plans[user_id]['rest_history']:
        if date_str.startswith(current_month_str):
            has_used = True
            break
    
    if has_used:
        await interaction.response.send_message(f"❌ **이번 달 휴식권을 이미 사용하셨어요!** (월 1회 제한)", ephemeral=True)
        return

    # 3. 휴식 처리
    user_plans[user_id]['rest_history'].append(target_date_str)
    
    await save_data(user_plans) # 저장 필수

    # 4. 결과 메시지
    embed = discord.Embed(title="🛌 휴식권 사용!", description=f"**{target_date_str}** {note}\n오늘은 푹 쉬세요! 벌금이 부과되지 않습니다.", color=discord.Color.purple())
    embed.set_footer(text="⚠️ 월 1회만 가능하니 신중하게 사용하세요!")
    
    await interaction.response.send_message(embed=embed)

#휴식취소
@bot.tree.command(name="휴식취소", description="방금 사용한 휴식권을 취소합니다. (되돌리기)")
async def cancel_rest(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    
    if user_id not in user_plans:
        await interaction.response.send_message("❌ 등록된 데이터가 없습니다.", ephemeral=True)
        return

    # 1. 취소할 날짜 계산 (새벽 보정 로직과 똑같이 맞춰야 찾을 수 있음)
    now = get_now()
    if 0 <= now.hour < 6:
        target_date = now - timedelta(days=1)
    else:
        target_date = now
    
    target_date_str = target_date.strftime('%Y-%m-%d')
    
    # 2. 데이터 확인 및 삭제
    deleted = False
    
    # 휴식 기록에서 삭제
    if 'rest_history' in user_plans[user_id] and target_date_str in user_plans[user_id]['rest_history']:
        user_plans[user_id]['rest_history'].remove(target_date_str)
        deleted = True
    
    if deleted:
        await save_data(user_plans)
        await interaction.response.send_message(f"↩️ **{target_date_str}** 날짜의 휴식 사용을 취소했습니다! 다시 횟수가 복구되었어요.", ephemeral=True)
    else:
        await interaction.response.send_message(f"❓ **{target_date_str}** 날짜로 사용된 휴식권이 없는데요?", ephemeral=True)

#관리자 휴식 강제 부여/삭제
@bot.tree.command(name="관리자_휴식관리", description="[관리자] 특정 유저의 휴식 날짜를 넣거나 뺍니다.")
@app_commands.describe(동작="추가/삭제", 유저="대상 유저", 날짜="YYYY-MM-DD")
@app_commands.choices(동작=[
    app_commands.Choice(name="휴식 부여 (추가)", value="add"),
    app_commands.Choice(name="휴식 취소 (삭제)", value="remove")
])
@app_commands.checks.has_permissions(administrator=True)
async def admin_manage_rest(interaction: discord.Interaction, 동작: app_commands.Choice[str], 유저: discord.Member, 날짜: str):
    user_id = str(유저.id)
    
    # 날짜 형식 체크
    try:
        datetime.strptime(날짜, "%Y-%m-%d")
    except ValueError:
        await interaction.response.send_message("❌ 날짜 형식이 틀렸어요! **2026-01-18** 처럼 적어주세요.", ephemeral=True)
        return

    if user_id not in user_plans: user_plans[user_id] = {}
    if 'rest_history' not in user_plans[user_id]: user_plans[user_id]['rest_history'] = []
    if 'exemptions' not in user_plans[user_id]: user_plans[user_id]['exemptions'] = []

    if 동작.value == "add":
        # 추가 로직
        if 날짜 not in user_plans[user_id]['rest_history']:
            user_plans[user_id]['rest_history'].append(날짜)
        
        await save_data(user_plans)
        await interaction.response.send_message(f"🔧 **{유저.display_name}**님에게 **{날짜}** 휴식을 강제로 선물했습니다. 🎁")

    else:
        # 삭제 로직
        if 날짜 in user_plans[user_id]['rest_history']:
            user_plans[user_id]['rest_history'].remove(날짜)
            
        await save_data(user_plans)
        await interaction.response.send_message(f"🔧 **{유저.display_name}**님의 **{날짜}** 휴식 기록을 삭제했습니다. 🗑️")

#주간 목표 수정
# [핵심] 이번 주 유효 목표 횟수 계산기 (면책/휴식 자동 차감)
def get_weekly_target(user_id, plan, target_date=None):
    if target_date is None:
        target_date = get_now()
    
    # 1. 이번 주 시작(월) ~ 끝(일) 날짜 구하기
    start_of_week = target_date - timedelta(days=target_date.weekday())
    start_of_week_str = start_of_week.strftime('%Y-%m-%d')
    end_of_week = start_of_week + timedelta(days=6)
    end_of_week_str = end_of_week.strftime('%Y-%m-%d')

    original_target = plan.get('count', 1)

    # 2. [수동] '이번주목표'로 강제 수정한 값이 있으면 최우선 적용
    overrides = plan.get('overrides', {})
    if start_of_week_str in overrides:
        return overrides[start_of_week_str]

    # 3. [자동] 이번 주에 포함된 휴식 & 면책 날짜 세기
    deduction = 0
    if user_id in user_plans:
        data = user_plans[user_id]
        
        # (1) 휴식 날짜 카운트
        rest_list = data.get('rest_history', [])
        for r_date in rest_list:
            if start_of_week_str <= r_date <= end_of_week_str:
                deduction += 1
        
        # (2) 면책 날짜 카운트 (기간 면책 포함)
        # * 휴식과 겹치는 날은 중복해서 빼지 않음
        exempt_list = data.get('exemptions', [])
        for e_date in exempt_list:
             if start_of_week_str <= e_date <= end_of_week_str:
                 if e_date not in rest_list:
                     deduction += 1

    # 4. 최종 목표 (원래목표 - 뺄셈), 최소 0보다는 작아질 수 없음
    final_target = max(0, original_target - deduction)
    return final_target

# 이번 주 한정 목표 수정 명령어
@bot.tree.command(name="이번주목표", description="이번 주만 적용될 주간 목표 횟수를 수정합니다.")
@app_commands.describe(계획="수정할 주간 계획 선택", 횟수="이번 주에 적용할 목표 횟수 (0이면 면제)")
@app_commands.autocomplete(계획=plan_autocomplete)
async def set_weekly_override(interaction: discord.Interaction, 계획: str, 횟수: int):
    user_id = str(interaction.user.id)
    
    if user_id not in user_plans:
        await interaction.response.send_message("❌ 등록된 계획이 없습니다.", ephemeral=True)
        return

    now = get_now()
    # 이번 주 월요일 날짜를 키(Key)로 사용
    start_of_week = now - timedelta(days=now.weekday())
    start_of_week_str = start_of_week.strftime('%Y-%m-%d')

    target_plan = None
    
    # 계획 찾기
    if "Weekly" in user_plans[user_id]:
        for plan in user_plans[user_id]["Weekly"]:
            if isinstance(plan, str): continue
            if plan['content'] == 계획:
                target_plan = plan
                break
    
    if not target_plan:
        await interaction.response.send_message("❌ 해당 주간 계획을 찾을 수 없습니다.", ephemeral=True)
        return

    # 데이터 저장 구조: 'overrides': {'2026-02-09': 3}
    if 'overrides' not in target_plan:
        target_plan['overrides'] = {}
    
    target_plan['overrides'][start_of_week_str] = 횟수
    await save_data(user_plans)

    embed = discord.Embed(title="📅 이번 주 목표 수정 완료", color=discord.Color.orange())
    embed.description = f"**{계획}**의 이번 주 목표를 **{횟수}회**로 변경했습니다.\n(다음 주가 되면 원래대로 돌아갑니다.)"
    
    await interaction.response.send_message(embed=embed)

#현황
@bot.tree.command(name="현황", description="이번 달 멤버들의 휴식 및 면책 사용 내역을 확인합니다.")
async def check_monthly_status(interaction: discord.Interaction):
    now = get_now()
    this_month_str = now.strftime('%Y-%m') # 예: 2026-01
    
    embed = discord.Embed(title=f"📊 {now.month}월 현황판", description="이번 달 휴식 및 면책 사용 기록입니다.", color=discord.Color.blurple())
    
    # 서버에 있는 실제 멤버들만 조회
    members = [m for m in interaction.guild.members if not m.bot]
    
    has_data = False

    for member in members:
        user_id = str(member.id)

        if user_id not in user_plans:
            continue

        data = user_plans[user_id]

        #휴식 기록
        all_rests = data.get('rest_history', [])
        month_rests = [d for d in all_rests if d.startswith(this_month_str)]
        month_rests.sort()

        #면책 기록
        all_exempts = data.get('exemptions', [])
        month_exempts = [d for d in all_exempts if d.startswith(this_month_str)]

        #면책에서 휴식 제외
        pure_immunity = [d for d in month_exempts if d not in month_rests]
        pure_immunity.sort()

        if not month_rests and not pure_immunity:
            continue
            
        has_data = True

        def fmt_dates(dates):
            if not dates: return "없음"
            return ", ".join([f"**{d[8:]}일**" for d in dates])
        
        rest_txt = f"🛌 **휴식({len(month_rests)}회):** {fmt_dates(month_rests)}"
        imm_txt = f"🛡️ **면책({len(pure_immunity)}회):** {fmt_dates(pure_immunity)}"
        
        embed.add_field(name=f"👤 {member.display_name}", value=f"{rest_txt}\n{imm_txt}", inline=False)

    if not has_data:
        embed.description = "✨ 이번 달은 아직 휴식이나 면책을 쓴 사람이 없네요! 성실해요! 🔥"

    embed.set_footer(text=f"기준: {now.strftime('%Y년 %m월')}")
    await interaction.response.send_message(embed=embed)

#인증 처리
async def process_verification(interaction: discord.Interaction, 계획:str, 내용: str, 사진: discord.Attachment, is_yesterday: bool):
    if 사진 and not 사진.content_type.startswith("image/"):
        await interaction.response.send_message("❌ 사진 파일만 올릴 수 있어요!", ephemeral=True)
        return
    
    now = get_now()
    current_hour = now.hour

    if is_yesterday:
        if 0 <= current_hour < 6:
            target_date = now - timedelta(days=2) 
        else:
            target_date = now - timedelta(days=1)
        display_note = "(어제 늦은 인증😅)"

    else:
        if 0 <= current_hour < 6:
            target_date = now - timedelta(days=1)
            display_note = "(새벽🌙)"
        else:
            target_date = now
            display_note = ""

    target_date_str = target_date.strftime('%Y-%m-%d')
    
    start_of_week = target_date - timedelta(days=target_date.weekday())
    start_of_week_str = start_of_week.strftime('%Y-%m-%d')
    this_month_str = target_date.strftime('%Y-%m')
    
    user_id = str(interaction.user.id)
    target_weekday = WEEKDAY_NAMES[target_date.weekday()]

    if user_id in user_plans and "Routine" in user_plans[user_id]:
        for plan in user_plans[user_id]["Routine"]:
            if plan['content'] == 계획:
                if plan.get('days') and target_weekday not in plan['days']:
                    await interaction.response.send_message(f"❌ **'{계획}'**은(는) **{target_weekday}요일**에 하는 날이 아닙니다!", ephemeral=True)
                    return

    verified_plan_name = ""

    if user_id in user_plans:
        # [수정할 코드]
        for category, plans in user_plans[user_id].items():
            if category in ["alert_time", "fines", "exemptions", "rest_history"]: continue
            if not isinstance(plans, list): continue

            for plan in plans:
                if isinstance(plan, dict) and plan.get('content') == 계획:
                    if 'history' not in plan: plan['history'] = []
                    
                    if target_date_str not in plan['history']:
                        plan['history'].append(target_date_str)
                        plan['history'].sort()
                    
                    plan['last_verified'] = target_date_str

                    if category == "OneTime":
                        plan['completed'] = True
                        verified_plan_name = f"[목표달성] {plan['content']}"
                    else:
                        verified_plan_name = f"[{category}] {plan['content']}"

        await save_data(user_plans)

    if not verified_plan_name:
        await interaction.response.send_message("❌ 해당 계획을 찾을 수 없어요! 목록에서 선택해주세요.", ephemeral=True)
        return
    
    plan_text_list = []

    if user_id in user_plans:
        for freq, data_list in user_plans[user_id].items():
            if freq in ["alert_time", "fines", "exemptions", "rest_history"]: continue
            
            for plan in data_list:
                history = plan.get('history', [])
                if 'last_verified' in plan and not history:
                    history = [plan['last_verified']]
                
                status_mark = "⬜"
                status_text = ""

                #일일
                if freq == "Daily":
                    if target_date_str in history: status_mark = "✅"
                    status_text = "[매일]"

                # 요일
                elif freq == "Routine":
                    status_text = "[요일]"
                    if target_date_str in history: status_mark = "✅"

                elif freq == "Weekly":
                    weekly_count = sum(1 for d in history if d >= start_of_week_str)
                    final_target = get_weekly_target(user_id, plan, target_date)
                    
                    status_text = f"[{weekly_count}/{final_target}회]"
                    
                    # 1. 목표 달성 시 -> 초록 체크 (완료되었으니 숨김 처리)
                    if weekly_count >= final_target:
                        status_mark = "✅"

                    # 2. 오늘 인증했으면 -> 회색 체크
                    elif target_date_str in history:
                        status_mark = "☑️"

                elif freq == "Monthly":
                    monthly_count = sum(1 for d in history if d.startswith(this_month_str))
                    target_count = plan.get('count', 1)
                    
                    status_text = f"[{monthly_count}/{target_count}회]"
 
                    if monthly_count >= target_count:
                        status_mark = "✅"

                    elif target_date_str in history:
                        status_mark = "☑️"
                
                elif freq == "Interval":
                    interval = plan.get('interval', 2)
                    status_text = f"[{interval}일장]"

                    if history:
                        last_v_date_str = history[-1]

                        if target_date_str == last_v_date_str:
                            status_mark = "✅"
                            status_text += "(완료)"

                        else:
                            curr_dt = datetime.strptime(target_date_str, "%Y-%m-%d")
                            last_dt = datetime.strptime(last_v_date_str, "%Y-%m-%d")
                            diff = (curr_dt - last_dt).days

                            if diff > interval: 
                                status_mark = "🚨"
                                status_text += f"(D+{diff-interval})"
                            elif diff == interval:
                                status_mark = "🔥"
                                status_text += "(오늘 마감!)"
                            else:
                                status_mark = "💤"
                                status_text += f"(D-{interval-diff})"
                    else:
                        status_mark = "🚨"

                elif freq == "OneTime":
                    deadline = plan.get('deadline', '9999-12-31')
                    is_completed = plan.get('completed', False)
                    
                    if is_completed:
                        status_mark = "🏆"
                        status_text = "[목표달성]"
                    else:
                        # 마감일 지났는지 체크
                        today_dt = datetime.strptime(target_date_str, "%Y-%m-%d")
                        deadline_dt = datetime.strptime(deadline, "%Y-%m-%d")
                        days_left = (deadline_dt - today_dt).days
                        
                        if days_left < 0:
                            status_mark = "💀"
                            status_text = f"[마감지남 D+{abs(days_left)}]"
                        elif days_left == 0:
                            status_mark = "🔥"
                            status_text = "[오늘마감]"
                        else:
                            status_mark = "⏳"
                            status_text = f"[D-{days_left}]"

                content_display = plan['content']
                if plan['content'] == 계획:
                    content_display = f"**{content_display}**"

                if locals().get('is_hidden', False):
                    continue

                plan_text_list.append(f"{status_mark} {status_text} {content_display}")

    final_text = "\n".join(plan_text_list) if plan_text_list else "계획 없음"

    embed = discord.Embed(title="🔥 인증 현황", color=discord.Color.green())
    embed.add_field(name="방금 인증함", value=verified_plan_name if verified_plan_name else 계획, inline=False)
    embed.add_field(name="인증 기준일", value=f"{target_date_str} {display_note}", inline=False)
    
    if 내용: embed.add_field(name="코멘트", value=내용, inline=False)
    embed.add_field(name="📅 현재 진행 상황", value=final_text, inline=False)
    if 사진: embed.set_image(url=사진.url)
    
    await interaction.response.send_message(embed=embed)

#계획 인증(오늘)
@bot.tree.command(name="인증", description="한 내용을 인증하세요")
@app_commands.describe(계획="인증할 계획 선택", 내용="코멘트 (선택)", 사진="인증샷 (선택)")
@app_commands.autocomplete(계획=plan_autocomplete)
async def verify_study(interaction: discord.Interaction, 계획:str, 내용: str=None, 사진: discord.Attachment=None):
    await process_verification(interaction, 계획, 내용, 사진, is_yesterday=False)

#계획 인증(어제)
@bot.tree.command(name="어제인증", description="깜빡한 어제 계획을 인증합니다.")
@app_commands.describe(계획="인증할 계획 선택", 내용="코멘트 (선택)", 사진="인증샷 (선택)")
@app_commands.autocomplete(계획=plan_autocomplete)
async def verify_study_yesterday(interaction: discord.Interaction, 계획:str, 내용: str=None, 사진: discord.Attachment=None):
    await process_verification(interaction, 계획, 내용, 사진, is_yesterday=True)

#계획표
# [수정됨] 계획표 확인 (변수명 오타 수정)
@bot.tree.command(name="계획표", description="나의 계획과 달성 현황을 확인합니다.")
async def check_my_plans(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    
    if user_id not in user_plans or not user_plans[user_id]:
        await interaction.response.send_message("📭 등록된 계획이 없어요! `/계획등록` 명령어로 추가해보세요.", ephemeral=True)
        return
    
    now_kst = get_now()
    if 0 <= now_kst.hour < 6:
        display_date = now_kst - timedelta(days=1)
        note_date = "(새벽🌙)"
    else:
        display_date = now_kst
        note_date = ""

    today_str = display_date.strftime('%Y-%m-%d')
    start_of_week = display_date - timedelta(days=display_date.weekday())
    start_of_week_str = start_of_week.strftime('%Y-%m-%d')
    this_month_str = display_date.strftime('%Y-%m')

    embed = discord.Embed(title=f"📋 {interaction.user.display_name}님의 계획표", color=discord.Color.blue())

    has_plan = False
    
    category_order = ["Daily", "Routine", "Weekly", "Monthly", "Interval", "OneTime"]
    category_names = {
        "Daily": "🌞 매일 (Daily)",
        "Routine": "🔄 요일 (Routine)", # 추가된 부분!
        "Weekly": "📅 주간 (Weekly)",
        "Monthly": "🗓️ 월간 (Monthly)",
        "Interval": "🔁 반복 (Interval)",
        "OneTime": "🎯 목표 (One-Time)"
    }

    for category in category_order:
        if category not in user_plans[user_id]: continue
        plans = user_plans[user_id][category]
        if not plans: continue
        
        desc_list = []
        
        for plan in plans:
            if isinstance(plan, str): continue

            history = plan.get('history', [])
            content = plan['content']
            status_mark = "⬜"
            status_text = ""

            # 1. 일일
            if category == "Daily":
                if today_str in history:
                    status_mark = "✅"
                    status_text = f"~~{content}~~ (완료)"
                else:
                    status_text = content

            # 2. 요일
            elif category == "Routine":
                plan_days = plan.get('days', [])
                day_badge = f" ({', '.join(plan_days)})" if plan_days else " (요일 미지정)"
                
                if today_str in history:
                    status_mark = "✅"
                    status_text = f"~~{content}~~{day_badge} (완료)"
                else:
                    target_weekday = WEEKDAY_NAMES[display_date.weekday()]
                    if plan_days and target_weekday not in plan_days:
                        status_mark = "💤"
                        status_text = f"{content}{day_badge} (쉬는 날)"
                    else:
                        status_mark = "⬜"
                        status_text = f"{content}{day_badge}"

            # 2. 주간 (오타 수정된 부분)
            elif category == "Weekly":
                current_count = sum(1 for d in history if d >= start_of_week_str)
                
                # 👇 [수정] 변수명 통일 (original_target)
                original_target = plan.get('count', 1)
                real_target = get_weekly_target(user_id, plan, display_date)
                
                if real_target < original_target:
                    target_display = f"{real_target}회 (📉원래 {original_target}회)"
                else:
                    target_display = f"{real_target}회"

                if current_count >= real_target:
                    status_mark = "✅"
                    status_text = f"~~{content}~~ ({current_count}/{target_display})"
                elif today_str in history:
                    status_mark = "☑️"
                    status_text = f"{content} ({current_count}/{target_display})"
                else:
                    status_text = f"{content} ({current_count}/{target_display})"

            # 3. 월간
            elif category == "Monthly":
                current_count = sum(1 for d in history if d.startswith(this_month_str))
                target = plan.get('count', 1)
                
                if current_count >= target:
                    status_mark = "✅"
                    status_text = f"~~{content}~~ ({current_count}/{target}회)"
                elif today_str in history:
                    status_mark = "☑️"
                    status_text = f"{content} ({current_count}/{target}회)"
                else:
                    status_text = f"{content} ({current_count}/{target}회)"

            # 4. 반복
            elif category == "Interval":
                interval = plan.get('interval', 2)
                last_v_str = history[-1] if history else ""
                
                if last_v_str == today_str:
                    status_mark = "✅"
                    status_text = f"~~{content}~~ (오늘 완료)"
                elif not last_v_str:
                    status_mark = "🚨"
                    status_text = f"{content} (시작 전)"
                else:
                    curr_dt = datetime.strptime(today_str, "%Y-%m-%d")
                    last_dt = datetime.strptime(last_v_str, "%Y-%m-%d")
                    diff = (curr_dt - last_dt).days
                    
                    if diff > interval:
                        status_mark = "🚨"
                        status_text = f"{content} (마감지남 D+{diff-interval})"
                    elif diff == interval:
                        status_mark = "🔥"
                        status_text = f"{content} (오늘 마감!)"
                    else:
                        status_mark = "💤"
                        status_text = f"{content} (D-{interval-diff})"

            # 5. 목표
            elif category == "OneTime":
                deadline = plan.get('deadline', '9999-12-31')
                is_completed = plan.get('completed', False)

                if is_completed:
                    status_mark = "🏆"
                    status_text = f"~~{content}~~ (달성 완료!)"
                else:
                    today_dt = datetime.strptime(today_str, "%Y-%m-%d")
                    deadline_dt = datetime.strptime(deadline, "%Y-%m-%d")
                    days_left = (deadline_dt - today_dt).days

                    if days_left < 0:
                        status_mark = "💀"
                        status_text = f"{content} (마감 {abs(days_left)}일 지남)"
                    elif days_left == 0:
                        status_mark = "🔥"
                        status_text = f"{content} (오늘 마감!)"
                    else:
                        status_mark = "⏳"
                        status_text = f"{content} (D-{days_left})"

            desc_list.append(f"{status_mark} {status_text}")
        
        if desc_list:
            has_plan = True
            embed.add_field(name=category_names[category], value="\n".join(desc_list), inline=False)

    if not has_plan:
        embed.description = "등록된 계획이 없거나 내용이 비어있네요? 🤔"
    
    rest_cnt = len(user_plans[user_id].get('rest_history', []))
    exempt_cnt = len(user_plans[user_id].get('exemptions', []))
    embed.set_footer(text=f"기준: {today_str} {note_date} | 이번 달 휴식: {rest_cnt}회 / 면책: {exempt_cnt}회")
    
    await interaction.response.send_message(embed=embed)
    
#인증초기화
@bot.tree.command(name="인증초기화", description="[테스트용] 오늘의 모든 인증 도장을 지웁니다.")
async def reset_verification(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    
    if user_id in user_plans:
        # 오늘 날짜 구하기
        now = get_now()
        current_hour = now.hour

        if 0 <= current_hour < 6:
            target_date = now - timedelta(days=1) # 새벽이면 어제 거를 지워야 함
        else:
            target_date = now
            
        target_date_str = target_date.strftime('%Y-%m-%d')

        count = 0
        for category, plans in user_plans[user_id].items():
            if category in ["alert_time", "fines", "exemptions", "rest_history"]: continue
            if not isinstance(plans, list): continue
            
            for plan in plans:
                # 1. history에서 오늘 날짜 제거
                if 'history' in plan and target_date_str in plan['history']:
                    plan['history'].remove(target_date_str)
                    count += 1

                    #OneTime 계획이면 완료 상태도 취소
                    if category == "OneTime":
                        plan['completed'] = False
                
                # 2. last_verified가 오늘이면 삭제 (구버전 호환)
                if plan.get('last_verified') == target_date_str:
                    del plan['last_verified']

        await save_data(user_plans) # 변경사항 저장

        if count > 0:
            await interaction.response.send_message(f"🧹 **{target_date_str}** 날짜의 인증 도장 **{count}개**를 지웠습니다! ✨", ephemeral=True)
        else:
            await interaction.response.send_message(f"❓ **{target_date_str}** 날짜에 찍힌 도장이 없어요.", ephemeral=True)
    else:
        await interaction.response.send_message("❓ 등록된 계획이 없어서 초기화할 게 없네요.", ephemeral=True)

#알림 시간 설정
@bot.tree.command(name="알림시간", description="인증 검사 알림 시간 설정")
@app_commands.describe(시간="24시간")
async def set_alert_time(interaction: discord.Interaction, 시간:int):

    if 시간 < 0 or 시간 > 23:
        await interaction.response.send_message("❌ 시간은 **0부터 23** 사이의 숫자로 적어주세요!", ephemeral=True)
        return
    
    user_id = str(interaction.user.id)
    if user_id not in user_plans:
        user_plans[user_id] = {}

    user_plans[user_id]['alert_time'] = 시간
    await save_data(user_plans)

    msg = f"⏰ 알림 설정 완료! 매일 **{시간}시**에 인증 여부를 검사할게요! 👀"
    
    # 새벽 시간대(0~5시) 설정 시 추가 안내
    if 0 <= 시간 < 6:
        msg += "\n💡 **참고:** 새벽(0~5시)은 **'어제 날짜'**의 공부 기록을 검사합니다. (밤샘러를 위한 배려!)"

    await interaction.response.send_message(msg, ephemeral=True)

#감시자
@tasks.loop(minutes=60)
async def check_study_status():
    now = get_now()
    current_hour = now.hour
    today_str = now.strftime('%Y-%m-%d')

    # 날짜 계산
    yesterday = now - timedelta(days=1)
    yesterday_str = yesterday.strftime('%Y-%m-%d')

    if await try_reset_daily_study():
        print("🌅 지능형 초기화 완료: 새로운 하루가 시작되었습니다.")

    check_target_str = yesterday_str if 0 <= current_hour <= 6 else today_str
    print(f"⏰ 점검 중... {now.month}/{now.day} {current_hour}시 (인증기준: {check_target_str})")

    channel = bot.get_channel(ALERT_CHANNEL)
    if not channel: return

    #12시 벌금 정산
    if current_hour == 12:
        fine_msg_list = []
        FINE_AMOUNT = 3000 # 👈 벌금 3,000원 설정

        is_monday = (now.weekday() == 0) # 월요일 (지난주 검사)
        is_first_day = (now.day == 1)    # 1일 (지난달 검사)

        for user_id, data in user_plans.items():
            if user_id == "system_data": continue # 혹시 모를 예외 처리

            # 1. 어제 날짜로 면책권을 썼는지 확인
            exemptions = data.get('exemptions', [])
            is_exempt = (yesterday_str in exemptions)

            rest_history = data.get('rest_history', [])
            is_resting = (yesterday_str in rest_history)

            missed_something = False # 하나라도 놓쳤는지 확인용
            missed_details = []      # 무엇을 놓쳤는지 기록
            
            # 2. 어제 '일일 계획'을 안 했는지 체크
            if "Daily" in data:
                for plan in data["Daily"]:

                    history = plan.get('history', [])

                    if yesterday_str not in history:
                        missed_details.append(f"[일일]{plan['content']}")
            
            # (1.5) 어제 '요일 계획'을 안 했는지 체크
            if "Routine" in data:
                yesterday_dt = datetime.strptime(yesterday_str, '%Y-%m-%d')
                yesterday_weekday = WEEKDAY_NAMES[yesterday_dt.weekday()]

                for plan in data["Routine"]:
                    if isinstance(plan, str): continue

                    created_at = plan.get('created_at', '2000-01-01') # 예전 데이터 호환용
                    if yesterday_str < created_at:
                        continue

                    plan_days = plan.get('days', [])
                    # 어제 요일이 계획된 요일 목록에 있을 때만 검사!
                    if yesterday_weekday in plan_days:
                        if yesterday_str not in plan.get('history', []):
                            missed_details.append(f"[요일]{plan['content']}")

            # (2) [주간] 월요일이면 '지난주' 실적 체크
            if is_monday and "Weekly" in data:
                # 지난주 월요일 ~ 일요일 범위 계산
                last_week_start = now - timedelta(days=7) # 저번주 월
                last_week_end = now - timedelta(days=1)   # 저번주 일
                last_week_start_str = last_week_start.strftime('%Y-%m-%d')
                last_week_end_str = last_week_end.strftime('%Y-%m-%d')

                for plan in data["Weekly"]:
                    history = plan.get('history', [])
                    # 지난주 기간 내에 찍힌 도장 개수 세기
                    count = sum(1 for d in history if last_week_start_str <= d <= last_week_end_str)
                    target = plan.get('count', 1)
                    
                    if count < target:
                        missed_details.append(f"[주간]{plan['content']}({count}/{target}회)")

            # (3) [월간] 1일이면 '지난달' 실적 체크
            if is_first_day and "Monthly" in data:
                # 지난달 구하기 (오늘-1일 의 년-월)
                last_month_date = now - timedelta(days=1)
                last_month_str = last_month_date.strftime('%Y-%m')

                for plan in data["Monthly"]:
                    history = plan.get('history', [])
                    # 지난달 접두사로 시작하는 도장 개수 세기
                    count = sum(1 for d in history if d.startswith(last_month_str))
                    target = plan.get('count', 1)

                    if count < target:
                        missed_details.append(f"[월간]{plan['content']}({count}/{target}회)")
            
            if "OneTime" in data:
                for plan in data["OneTime"]:
                    # 마감일이 어제였고, 아직 완료(completed)가 False인 경우
                    if plan['deadline'] == yesterday_str and not plan.get('completed', False):
                        missed_details.append(f"[목표]{plan['content']}")

            # 벌금 처리
            if missed_details:
                if is_resting:
                    fine_msg_list.append(f"🛌 <@{user_id}>님 **휴식권 사용!** (푹 쉬셨나요? 🍯)")
                
                elif is_exempt:
                    fine_msg_list.append(f"🛡️ <@{user_id}>님 면책 통과! ({', '.join(missed_details)})")
                
                else:
                    # 건수 상관없이 하루 고정 벌금 or 건당 벌금 (여기선 고정 3000원 방식 유지)
                    # 만약 주간/월간 겹치는 날에 벌금을 더 걷고 싶으면 로직 변경 가능
                    current_fine = data.get('fines', 0)
                    data['fines'] = current_fine + FINE_AMOUNT
                    fine_msg_list.append(f"💸 <@{user_id}>님 **{FINE_AMOUNT}원** 벌금! ({', '.join(missed_details)})")

        await save_data(user_plans) # 저장

        # 4. 정산 결과 및 랭킹 출력
        if fine_msg_list:
            sorted_users = sorted(user_plans.items(), key=lambda x: x[1].get('fines', 0), reverse=True)
            rank_text = ""
            rank = 1
            for uid, udata in sorted_users:
                fine = udata.get('fines', 0)
                if fine > 0:
                    icon = ["🥇", "🥈", "🥉"][rank-1] if rank <= 3 else f"{rank}."
                    rank_text += f"{icon} <@{uid}>: **{fine:,}원**\n"
                    rank += 1
            
            title_txt = f"💸 {yesterday_str} 정산"
            if is_monday: title_txt += " (주간결산 포함)"
            if is_first_day: title_txt += " (월간결산 포함)"

            embed = discord.Embed(title=title_txt, description="**돈** 내기 싫으면 **까**먹지 말고 **스**스로 해라", color=discord.Color.red())
            embed.add_field(name="🧾 정산 결과", value="\n".join(fine_msg_list), inline=False)
            if rank_text: embed.add_field(name="🏆 명예의 전당", value=rank_text, inline=False)
            
            await channel.send(embed=embed)

    #2시 알림
    for user_id, data in user_plans.items():
        if data.get('alert_time', 2) == current_hour:
            
            if 0 <= current_hour < 6:
                alert_date = now - timedelta(days=1)
            else:
                alert_date = now
            
            alert_date_str = alert_date.strftime('%Y-%m-%d')
            alert_start_week = alert_date - timedelta(days=alert_date.weekday())
            alert_start_week_str = alert_start_week.strftime('%Y-%m-%d')
            alert_month_str = alert_date.strftime('%Y-%m')

            exemptions = data.get('exemptions', [])
            is_exempt = (alert_date_str in exemptions)

            rest_history = data.get('rest_history', [])
            is_resting = (alert_date_str in rest_history)
            
            if is_exempt or is_resting: continue

            # 알림 메시지용 리스트
            todo_daily, todo_routine, todo_weekly, todo_monthly, todo_interval, todo_onetime = [], [], [], [], [], []

            # (1) 일일 (오늘 안 했으면 알림)
            if "Daily" in data:
                for plan in data["Daily"]:
                    if isinstance(plan, str): continue
                    if alert_date_str not in plan.get('history', []):
                        todo_daily.append(plan['content'])

            if "Routine" in data:
                alert_weekday = WEEKDAY_NAMES[alert_date.weekday()]
                for plan in data["Routine"]:
                    if isinstance(plan, str): continue

                    plan_days = plan.get('days', [])
                    # 알림 날짜가 계획된 요일에 포함되는지 확인
                    if alert_weekday in plan_days:
                        # 오늘 인증(history)을 아직 안 했는지 확인
                        if alert_date_str not in plan.get('history', []):
                            todo_routine.append(plan['content'])

            # (2) 주간 (Weekly)
            if "Weekly" in data:
                # 금,토,일요일에만 검사 (또는 원하시는 요일)
                if alert_date.weekday() >= 4:
                    for plan in data["Weekly"]:
                        if isinstance(plan, str): continue
                        
                        # 오늘 이미 했으면 패스
                        if alert_date_str in plan.get('history', []):
                            continue 

                        # 현재까지 수행한 횟수
                        cnt = sum(1 for d in plan.get('history', []) if d >= alert_start_week_str)
                        
                        # 👇 [수정됨] 고정된 count 대신, 유동적인 목표(target)를 가져옵니다!
                        # 휴식/면책이 있으면 target이 줄어듭니다.
                        target = get_weekly_target(user_id, plan, alert_date)
                        
                        # 목표가 0이 되었으면(휴식을 많이 써서) 알림 안 보냄
                        if target > 0 and cnt < target:
                            todo_weekly.append(f"{plan['content']}({cnt}/{target})")
                            
            # (3) 월간 (이번달 남은 횟수 알림 - 월말에만 강조)
            last_day_of_month = calendar.monthrange(alert_date.year, alert_date.month)[1]
            if "Monthly" in data and (alert_date.day in [20, 25] or alert_date.day == last_day_of_month):
                for plan in data["Monthly"]:
                    if isinstance(plan, str): continue

                    if alert_date_str in plan.get('history', []):
                        continue

                    cnt = sum(1 for d in plan.get('history', []) if d.startswith(alert_month_str))
                    target = plan.get('count', 1)
                    
                    if cnt < target:
                        todo_monthly.append(f"{plan['content']}({cnt}/{target})")

            # (4) N일 간격 (오늘 해야 하는지 체크)
            if "Interval" in data:
                for plan in data["Interval"]:
                    hist = plan.get('history', [])
                    interval = plan.get('interval', 1)
                    if not hist:
                        todo_interval.append(f"{plan['content']}(시작안함)")
                    elif alert_date_str != hist[-1]:
                        last_dt = datetime.strptime(hist[-1], "%Y-%m-%d")
                        # 알림 기준 날짜(alert_date)와 마지막 인증일 비교
                        diff = (alert_date.date() - last_dt.date()).days
                        if diff >= interval:
                            todo_interval.append(f"{plan['content']}(D+{diff-interval})")

            # 👇 [추가] (5) 목표 (OneTime) - 마감 임박 알림!
            if "OneTime" in data:
                for plan in data["OneTime"]:
                    if not plan.get('completed', False):
                        deadline = plan.get('deadline', '9999-12-31')
                        d_dt = datetime.strptime(deadline, "%Y-%m-%d")
                        a_dt = datetime.strptime(alert_date_str, "%Y-%m-%d") # 시간 제거
                        days_left = (d_dt - a_dt).days
                        
                        # 마감 당일이거나, 3일 전부터 알림
                        if days_left == 0:
                             todo_onetime.append(f"🔥 {plan['content']}(오늘마감!)")
                        elif 0 < days_left <= 3:
                             todo_onetime.append(f"⏳ {plan['content']}(D-{days_left})")

            # 알림 전송
            if any([todo_daily,todo_routine, todo_weekly, todo_monthly, todo_interval, todo_onetime]):
                msg = f"🔔 <@{user_id}>님! 인증할 시간이에요!\n"
                if todo_daily: msg += f"- **[일일]** {', '.join(todo_daily)}\n"
                if todo_routine: msg += f"- **[요일]** {', '.join(todo_routine)}\n"
                if todo_weekly: msg += f"- **[주간]** {', '.join(todo_weekly)}\n"
                if todo_monthly: msg += f"- **[월간]** {', '.join(todo_monthly)}\n"
                if todo_interval: msg += f"- **[반복]** {', '.join(todo_interval)}\n"
                if todo_onetime: msg += f"- **[목표]** {', '.join(todo_onetime)}\n"

                await channel.send(msg)

#정각 대기
@check_study_status.before_loop
async def before_check_study_status():
    await bot.wait_until_ready()
    now = get_now()
    # 다음 정각까지 남은 초 계산
    future = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    
    seconds_until_next_hour = (future - now).total_seconds()

    print(f"⏳ 다음 정각({future.hour}시)까지 {int(seconds_until_next_hour)}초 대기합니다...")
    await asyncio.sleep(seconds_until_next_hour)

#벌금 수정
@bot.tree.command(name="벌금수정", description="특정 유저의 벌금을 수정합니다.")
@app_commands.describe(유저="대상 유저", 금액="수정할 최종 금액 (예: 0, 5000)", 사유="수정 사유")
@app_commands.checks.has_permissions(administrator=True)
async def adjust_fine(interaction: discord.Interaction, 유저: discord.Member, 금액: int, 사유: str = "관리자 수정"):
    user_id = str(유저.id)
    
    if user_id not in user_plans:
        await interaction.response.send_message("❌ 데이터가 없는 유저입니다.", ephemeral=True)
        return
    
    # 기존 벌금
    old_fine = user_plans[user_id].get('fines', 0)
    
    # 벌금 수정
    user_plans[user_id]['fines'] = 금액
    await save_data(user_plans)
    
    embed = discord.Embed(title="🔧 벌금 조정 완료", color=discord.Color.gold())
    embed.add_field(name="대상", value=유저.mention, inline=True)
    embed.add_field(name="변경 전", value=f"{old_fine:,}원", inline=True)
    embed.add_field(name="변경 후", value=f"**{금액:,}원**", inline=True)
    embed.add_field(name="사유", value=사유, inline=False)
    
    await interaction.response.send_message(embed=embed)

@adjust_fine.error
async def adjust_fine_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.MissingPermissions):
        await interaction.response.send_message("❌ 관리자만 사용할 수 있는 명령어입니다!", ephemeral=True)

#공부 시간 측정
@bot.event
async def on_voice_state_update(member, before, after):
    global study_sessions, daily_study_times

    target_channel = bot.get_channel(TARGET_CHANNEL)
    alert_channel = bot.get_channel(TEST_CHANNEL)

    if member.bot or before.channel == after.channel:
        return

    #입장
    if after.channel is not None and after.channel.id == TARGET_CHANNEL:
        # 1. 메모리에 기록
        study_sessions[member.id] = get_now()
        # 2. 파일에도 기록 (재부팅 대비) 👇
        await save_session_data(study_sessions)

        if alert_channel:
            await alert_channel.send(f"✅ {member.display_name}님이 공부방에 입장했습니다!")
    #퇴장
    elif before.channel is not None and before.channel.id == TARGET_CHANNEL and (after.channel is None or after.channel.id != TARGET_CHANNEL):
        if member.id in study_sessions:
            if alert_channel:
                await alert_channel.send(f"🛑 {member.display_name}님이 공부방에서 퇴장했습니다!")
            
            start_time = study_sessions.pop(member.id)
            duration = get_now() - start_time
            seconds = int(duration.total_seconds())

            await save_session_data(study_sessions)

            current_total = daily_study_times.get(member.id, 0) + seconds
            daily_study_times[member.id] = current_total

            await save_time_data(daily_study_times)

            def fmt(s):
                h, r = divmod(s, 3600)
                m, s = divmod(r, 60)
                return f"{h}시간 {m}분 {s}초"

            msg = f"⏱️ 이번 시간: **{fmt(seconds)}**\n"
            msg += f"📚 오늘 총합: **{fmt(current_total)}**"
            
            if alert_channel:
                await alert_channel.send(msg)

#공지
@bot.tree.command(name="공지", description="채널에 임베드 공지를 보냅니다.")
@app_commands.describe(제목="공지 제목", 내용="내용 ('\\n'으로 줄바꿈 가능)")
async def send_notice(interaction: discord.Interaction, 제목: str, 내용: str):
    
    target_channel = bot.get_channel(ALERT_CHANNEL)

    if not target_channel:
        await interaction.response.send_message("❌ 공지 채널을 찾을 수 없어요! 코드 상단의 ALERT_CHANNEL ID를 확인해주세요.", ephemeral=True)
        return

    # 줄바꿈 처리
    final_content = 내용.replace("\\n", "\n")

    #임베드 만들기
    embed = discord.Embed(
        title=제목,
        description=final_content,
        color=discord.Color.gold() # 색상 변경 가능 (blue, red, green 등)
    )
    
    # 꾸미기 요소 (선택사항)
    embed.set_footer(text=f"작성자: {interaction.user.display_name}", icon_url=interaction.user.display_avatar.url)
    embed.set_thumbnail(url=bot.user.display_avatar.url)
    
    #보낸 사람에게 확인 메시지 (나만 보임)
    await target_channel.send(embed=embed)
    await interaction.response.send_message(f"✅ {target_channel.mention}에 공지를 등록했습니다!", ephemeral=True)

#칭찬
@bot.tree.command(name="칭찬", description="무작위 칭찬 멘트로 자존감을 채워줍니다!")
async def praise_me(interaction: discord.Interaction):
    # 칭찬 멘트 리스트 (원하는 멘트를 여기에 마음껏 추가하세요!)
    messages = [
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

    # 랜덤 선택
    selected = random .choice(messages)

    # 메시지 전송
    await interaction.response.send_message(f"📢 **{interaction.user.display_name}**님, {selected}")

#데이터청소(면책)
@bot.tree.command(name="데이터청소_면책", description="[관리자] 잘못 들어가서 깨진(1글자짜리) 면책 데이터를 삭제합니다.")
@app_commands.checks.has_permissions(administrator=True)
async def clean_broken_exemptions(interaction: discord.Interaction):
    cleaned_count = 0
    target_users = []

    for user_id, data  in user_plans.items():
        if 'exemptions' in data:
            original_list = data['exemptions']
            # 길이가 5보다 작은 것(예: "2", "-", "0")은 잘못된 데이터로 간주하고 삭제
            # 정상 날짜 "2026-01-21"은 길이가 10임
            new_list = [d for d in original_list if len(d) > 5]
            
            diff = len(original_list) - len(new_list)
            if diff > 0:
                data['exemptions'] = new_list
                cleaned_count += diff
                target_users.append(f"<@{user_id}>")

    if cleaned_count > 0:
        await save_data(user_plans)
        await interaction.response.send_message(f"🧹 **청소 완료!**\n잘못된 면책 데이터 **{cleaned_count}개**를 삭제했습니다.\n대상: {', '.join(target_users)}")
    else:
        await interaction.response.send_message("✨ 데이터가 깨끗합니다! 잘못된 기록이 없어요.", ephemeral=True)

@bot.tree.command(name="ping", description="Ping & Pong")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message("Pong! 🏓")

@bot.tree.command(name="dice", description="1부터 6까지 주사위를 굴립니다.")
async def dice(interaction: discord.Interaction):
    num = random.randrange(1, 7)
    await interaction.response.send_message(f'🎲 주사위 결과: **{num}**')

bot.run(TOKEN)