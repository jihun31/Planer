import discord
import os
import json
import random
import calendar
import asyncio
import re
import shutil
import traceback
from pathlib import Path
from discord import ui, app_commands
from discord.ext import tasks, commands
from dotenv import load_dotenv
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# 이 파일(main.py)이 있는 폴더. 어디서 실행하든 .env와 데이터 파일을 이 폴더에서 찾음
BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")
TOKEN = os.getenv('TOKEN')

#채널 아이디 (.env 파일에서 불러옴)
def get_id_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f".env 파일에 {name} 값이 없습니다. .env.example을 참고해 추가해주세요.")
    try:
        return int(value)
    except ValueError:
        raise RuntimeError(f".env 파일의 {name} 값은 숫자 ID여야 합니다. (현재 값: {value!r})")

TARGET_CHANNEL = get_id_env('TARGET_CHANNEL')
ALERT_CHANNEL = get_id_env('ALERT_CHANNEL')
TEST_CHANNEL = get_id_env('TEST_CHANNEL')
WELCOME_CHANNEL = get_id_env('WELCOME_CHANNEL')

WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]

# 입력 글자 수 제한 (디스코드 표시 제한을 넘지 않도록)
PlanText = app_commands.Range[str, 1, 80]       # 계획 이름 (자동완성 선택지 최대 100자)
LongText = app_commands.Range[str, 1, 1000]     # 사유/코멘트 (임베드 칸 최대 1024자)

intents = discord.Intents.default()
# 슬래시 명령어만 쓰므로 message_content 권한은 필요 없음
# members는 개발자 포털에서 "Server Members Intent"를 켜야 함
intents.members = True
intents.voice_states = True

bot = commands.Bot(command_prefix='!', intents=intents)

KST = ZoneInfo("Asia/Seoul")

def get_now():
    return datetime.now(KST)

data_lock = asyncio.Lock()
time_lock = asyncio.Lock()

#파일 저장/불러오기 공통 함수
def load_json_file(path, default):
    """JSON 파일을 읽음. 파일이 깨졌으면 원본을 백업해 두고 default로 시작함."""
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        stamp = get_now().strftime('%Y%m%d-%H%M%S')
        backup = path.with_name(f"{path.name}.broken-{stamp}")
        shutil.copy2(path, backup)
        print(f"🚨 {path.name} 파일이 손상되어 읽을 수 없습니다 ({e}).")
        print(f"🚨 원본을 {backup.name} 으로 백업하고 빈 값으로 시작합니다.")
        return default

def _atomic_write_text(path, text):
    # 임시 파일에 다 쓴 다음 한 번에 교체 → 저장 도중 꺼져도 기존 파일이 깨지지 않음
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

async def write_json_file(path, data, lock):
    # JSON 변환은 여기서 바로 끝냄 → 저장하는 동안 다른 명령이 데이터를 바꿔도 안전
    text = json.dumps(data, indent=4, ensure_ascii=False)
    async with lock:
        await asyncio.get_running_loop().run_in_executor(None, _atomic_write_text, path, text)

#파일 관리
DATA_FILE = BASE_DIR / "study_plans.json"
def load_data():
    return load_json_file(DATA_FILE, {})

async def save_data(data):
    await write_json_file(DATA_FILE, data, data_lock)

#공부 시간 관리
TIME_FILE = BASE_DIR / "study_times.json"
last_reset_date_str = ""

def load_time_data():
    global last_reset_date_str
    raw_data = load_json_file(TIME_FILE, {})
    try:
        # 구버전 데이터 호환 (날짜 키가 없으면 구버전으로 간주)
        if "users" not in raw_data:
            return {int(k): v for k, v in raw_data.items()}

        # 신버전 데이터
        last_reset_date_str = raw_data.get("last_date", "")
        return {int(k): v for k, v in raw_data["users"].items()}
    except (ValueError, TypeError, AttributeError) as e:
        print(f"⚠️ {TIME_FILE.name} 내용 형식이 이상해서 빈 값으로 시작합니다: {e}")
        return {}

async def save_time_data(data):
    # 저장할 때는 날짜와 데이터를 묶어서 저장
    payload = {
        "last_date": last_reset_date_str, # 현재 기억하고 있는 날짜
        "users": data
    }
    await write_json_file(TIME_FILE, payload, time_lock)

async def try_reset_daily_study():
    global last_reset_date_str
    
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
SESSION_FILE = BASE_DIR / "active_sessions.json"
session_lock = asyncio.Lock()    

def load_session_data():
    data = load_json_file(SESSION_FILE, {})
    try:
        # 저장된 시간(숫자)을 다시 날짜 객체로 변환
        # 키(user_id)는 정수형(int)으로 변환
        return {int(uid): datetime.fromtimestamp(ts, KST) for uid, ts in data.items()}
    except (ValueError, TypeError, AttributeError, OSError) as e:
        print(f"⚠️ {SESSION_FILE.name} 내용 형식이 이상해서 빈 값으로 시작합니다: {e}")
        return {}

async def save_session_data(data):
    # 날짜 객체는 JSON 저장 안 됨 -> timestamp(숫자)로 변환해서 저장
    serializable_data = {str(uid): dt.timestamp() for uid, dt in data.items()}
    await write_json_file(SESSION_FILE, serializable_data, session_lock)

#투표 데이터 관리
VOTE_FILE = BASE_DIR / "active_votes.json"
vote_lock = asyncio.Lock()

def load_vote_data():
    # 키(message_id)는 문자열로 저장되므로, 읽을 때도 그대로 둠
    return load_json_file(VOTE_FILE, {})

async def save_vote_data(data):
    await write_json_file(VOTE_FILE, data, vote_lock)

#정산 기록 관리 (12시 정산을 하루에 정확히 한 번만 하기 위함)
STATE_FILE = BASE_DIR / "bot_state.json"
state_lock = asyncio.Lock()

def load_state_data():
    state = load_json_file(STATE_FILE, None)
    if not isinstance(state, dict):
        # 처음 실행: 이미 12시가 지났으면 오늘 정산은 기존 봇이 했다고 보고 건너뜀 (중복 벌금 방지)
        now = get_now()
        last = now if now.hour >= SETTLEMENT_HOUR else now - timedelta(days=1)
        state = {"last_settlement_date": last.strftime('%Y-%m-%d')}
    return state

async def save_state_data(data):
    await write_json_file(STATE_FILE, data, state_lock)

#디스코드 글자 수 제한 대응
EMBED_FIELD_LIMIT = 1024   # 임베드 칸(field) 하나의 최대 글자 수
EMBED_TOTAL_LIMIT = 5500   # 임베드 전체 최대 6000자, 여유를 둠
EMBED_MAX_FIELDS = 25      # 임베드 하나에 들어가는 최대 칸 수
MESSAGE_LIMIT = 2000       # 일반 메시지 최대 글자 수

def split_text(text, limit):
    """줄 단위로 limit 글자 이하 덩어리로 나눔. 한 줄이 너무 길면 잘라냄."""
    chunks, current = [], ""
    for line in str(text).split("\n"):
        if len(line) > limit:
            line = line[:limit - 1] + "…"
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit:
            chunks.append(current)
            current = line
        else:
            current = candidate
    if current or not chunks:
        chunks.append(current or "-")
    return chunks

def build_embeds(title, color, description=None, fields=(), footer=None, image_url=None, thumbnail_url=None):
    """
    fields: (이름, 내용, inline) 목록.
    내용이 길면 칸을 나누고, 칸이 너무 많으면 임베드를 여러 개로 나눠서 돌려줌.
    """
    def new_embed(first):
        e = discord.Embed(title=title if first else f"{title} (계속)", color=color)
        if first and description:
            e.description = description[:4000]
        return e

    embeds = [new_embed(True)]
    for name, value, inline in fields:
        for i, chunk in enumerate(split_text(value, EMBED_FIELD_LIMIT)):
            field_name = (name if i == 0 else f"{name} (계속)")[:256]
            e = embeds[-1]
            if len(e.fields) >= EMBED_MAX_FIELDS or len(e) + len(field_name) + len(chunk) > EMBED_TOTAL_LIMIT:
                e = new_embed(False)
                embeds.append(e)
            e.add_field(name=field_name, value=chunk, inline=inline)

    if footer:
        embeds[-1].set_footer(text=footer[:300])
    if image_url:
        embeds[0].set_image(url=image_url)
    if thumbnail_url:
        embeds[0].set_thumbnail(url=thumbnail_url)
    return embeds

async def send_embeds(channel, embeds, content=None):
    for i, embed in enumerate(embeds):
        await channel.send(content=content if i == 0 else None, embed=embed)

async def respond_embeds(interaction, embeds, ephemeral=False):
    # 디스코드는 메시지 하나에 임베드 전체 6000자 제한이 있어서 하나씩 보냄
    await interaction.response.send_message(embed=embeds[0], ephemeral=ephemeral)
    for embed in embeds[1:]:
        await interaction.followup.send(embed=embed, ephemeral=ephemeral)

async def send_long_message(channel, text):
    for chunk in split_text(text, MESSAGE_LIMIT):
        await channel.send(chunk)

def fit_choice(name):
    # 자동완성 선택지 이름은 최대 100자
    return name if len(name) <= 100 else name[:99] + "…"

#계획
user_plans = load_data()

#진행 중인 투표 (메모리에 두고 바뀔 때마다 파일에 저장)
active_votes = load_vote_data()

#정산 설정
SETTLEMENT_HOUR = 12  # 매일 이 시각(이후)에 어제 기록을 정산
FINE_AMOUNT = 3000    # 벌금 3,000원
bot_state = load_state_data()

#계획 데이터 공통 함수
# 유저 데이터 중 '계획 목록'인 항목. 나머지(alert_time, fines, exemptions, rest_history 등)는 설정/기록
PLAN_CATEGORIES = ["Daily", "Routine", "Weekly", "Monthly", "Interval", "OneTime"]
CATEGORY_KR = {"Daily": "일일", "Routine": "요일", "Weekly": "주간", "Monthly": "월간", "Interval": "반복", "OneTime": "목표"}

def photo_icon(photo_required):
    return "📸 사진 필수" if photo_required else "📝 내용만"

def get_base_date(now=None):
    """새벽 0~5시는 전날로 취급한 '기준 날짜' (밤샘 인증 배려)"""
    if now is None:
        now = get_now()
    return now - timedelta(days=1) if now.hour < 6 else now

def iter_plans(user_data, categories=PLAN_CATEGORIES):
    """(카테고리, 계획) 순서로 돌려줌. 옛날 형식(문자열)이나 깨진 계획은 건너뜀."""
    for category in categories:
        plans = user_data.get(category)
        if not isinstance(plans, list):
            continue
        for plan in plans:
            if isinstance(plan, dict) and "content" in plan:
                yield category, plan

def find_plan(user_id, content):
    """계획 이름으로 찾기. 없으면 (None, None)"""
    for category, plan in iter_plans(user_plans.get(user_id, {})):
        if plan["content"] == content:
            return category, plan
    return None, None

def week_bounds(date):
    """date가 속한 주의 (월요일, 다음 주 월요일) 날짜 문자열. 범위는 월요일 이상 ~ 다음 주 월요일 미만"""
    start = date - timedelta(days=date.weekday())
    return start.strftime('%Y-%m-%d'), (start + timedelta(days=7)).strftime('%Y-%m-%d')

def count_in_week(history, date):
    start, next_start = week_bounds(date)
    return sum(1 for d in history if start <= d < next_start)

def count_in_month(history, date):
    prefix = date.strftime('%Y-%m')
    return sum(1 for d in history if d.startswith(prefix))

def count_off_days(user_id, start_str, end_str):
    """기간(start~end, 양 끝 포함) 안의 휴식/면책 날짜 수. 휴식과 면책이 겹친 날은 한 번만 셈."""
    data = user_plans.get(user_id, {})
    off_days = set(data.get('rest_history', [])) | set(data.get('exemptions', []))
    return sum(1 for d in off_days if start_str <= d <= end_str)

def get_weekly_target(user_id, plan, target_date=None):
    """이번 주 실제 목표 횟수. '/이번주목표' 수정값이 최우선, 없으면 원래 목표에서 휴식/면책 일수만큼 뺌."""
    if target_date is None:
        target_date = get_now()

    start_str, _ = week_bounds(target_date)
    overrides = plan.get('overrides', {})
    if start_str in overrides:
        return overrides[start_str]

    end_str = (datetime.strptime(start_str, '%Y-%m-%d') + timedelta(days=6)).strftime('%Y-%m-%d')
    return max(0, plan.get('count', 1) - count_off_days(user_id, start_str, end_str))

def get_monthly_target(user_id, plan, target_date=None):
    """이번 달 실제 목표 횟수. 원래 목표에서 이번 달 휴식/면책 일수만큼 뺌 (주간 목표와 같은 방식)."""
    if target_date is None:
        target_date = get_now()

    last_day = calendar.monthrange(target_date.year, target_date.month)[1]
    start_str = target_date.strftime('%Y-%m-01')
    end_str = target_date.strftime(f'%Y-%m-{last_day:02d}')
    return max(0, plan.get('count', 1) - count_off_days(user_id, start_str, end_str))

#공부 시간 측정
study_sessions = {}
daily_study_times = {}

#봇 준비 
first_ready_done = False

@bot.event
async def on_ready():
    # on_ready는 연결이 끊겼다 다시 붙을 때도 실행됨
    # 명령어 동기화와 투표 버튼 복구는 처음 한 번만 (디스코드 요청 제한 방지)
    global daily_study_times, study_sessions, first_ready_done
    is_first_ready = not first_ready_done
    first_ready_done = True

    if is_first_ready:
        try:
            synced = await bot.tree.sync()
            print(f"🔁 슬래시 명령어 {len(synced)}개 동기화 완료")
        except discord.HTTPException as e:
            print(f"⚠️ 슬래시 명령어 동기화 실패: {e}")
    
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

    for msg_id, data in (active_votes.items() if is_first_ready else []):
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
                required_votes=req_votes,
                eligible_voters=data.get("eligible_voters")  # 예전 투표는 없음 → 누구나 투표 가능
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

PHOTO_CHOICES = [
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
]

async def register_plan(interaction: discord.Interaction, category: str, plan: dict) -> bool:
    """중복 이름을 검사하고 계획을 저장함. 중복이면 안내 메시지를 보내고 False를 돌려줌."""
    user_id = str(interaction.user.id)

    existing_category, _ = find_plan(user_id, plan['content'])
    if existing_category:
        await interaction.response.send_message(f"✋ **'{plan['content']}'** 계획은 이미 [{CATEGORY_KR[existing_category]}] 카테고리에 등록되어 있어요! 이름은 다르게 지어주세요.", ephemeral=True)
        return False

    plan.setdefault("history", [])
    plan.setdefault("created_at", get_now().strftime('%Y-%m-%d'))
    user_plans.setdefault(user_id, {}).setdefault(category, []).append(plan)
    await save_data(user_plans)
    return True

#일일계획
@plan_group.command(name="일일", description="매일 반복할 계획을 세웁니다.")
@app_commands.describe(내용="내용", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=PHOTO_CHOICES)
async def plan_daily(interaction: discord.Interaction, 내용: PlanText, 사진인증: app_commands.Choice[int]):
    photo = bool(사진인증.value)
    if await register_plan(interaction, "Daily", {"type": "매일", "content": 내용, "photo": photo}):
        await interaction.response.send_message(f"📅 **[일일] 계획 등록 완료!** ({photo_icon(photo)})\n- **내용:** {내용}")

#주간계획
@plan_group.command(name="주간", description="주간 계획을 세웁니다.")
@app_commands.describe(횟수="주N회 (1~7)", 내용="내용", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=PHOTO_CHOICES)
async def plan_weekly(interaction: discord.Interaction, 횟수: app_commands.Range[int, 1, 7], 내용: PlanText, 사진인증: app_commands.Choice[int]):
    photo = bool(사진인증.value)
    if await register_plan(interaction, "Weekly", {"type": "주간", "count": 횟수, "content": 내용, "photo": photo}):
        await interaction.response.send_message(f"📅 **[주간] 계획 등록 완료!** ({photo_icon(photo)})\n- **목표:** 주 {횟수}회\n- **내용:** {내용}")

#월간계획
@plan_group.command(name="월간", description="월간 계획을 세웁니다.")
@app_commands.describe(횟수="월N회 (1~31)", 내용="내용", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=PHOTO_CHOICES)
async def plan_monthly(interaction: discord.Interaction, 횟수: app_commands.Range[int, 1, 31], 내용: PlanText, 사진인증: app_commands.Choice[int]):
    photo = bool(사진인증.value)
    if await register_plan(interaction, "Monthly", {"type": "월간", "count": 횟수, "content": 내용, "photo": photo}):
        await interaction.response.send_message(f"📅 **[월간] 계획 등록 완료!** ({photo_icon(photo)})\n- **목표:** 월 {횟수}회\n- **내용:** {내용}")

#n일계획
@plan_group.command(name="n일", description="N일마다 반복하는 계획을 세웁니다")
@app_commands.describe(간격="며칠마다 할까요? (1~365)", 내용="내용", 사진인증="인증 방식")
@app_commands.choices(사진인증=PHOTO_CHOICES)
async def plan_interval(interaction: discord.Interaction, 간격: app_commands.Range[int, 1, 365], 내용: PlanText, 사진인증: app_commands.Choice[int]):
    photo = bool(사진인증.value)
    if await register_plan(interaction, "Interval", {"type": "N일", "interval": 간격, "content": 내용, "photo": photo}):
        await interaction.response.send_message(f"📅 **[{간격}일마다] 계획 등록!** ({photo_icon(photo)})\n- **내용:** {내용}")

#일회성 목표
@plan_group.command(name="목표", description="특정 날짜까지 완수해야 하는 1회성 목표를 세웁니다.")
@app_commands.describe(마감일="YYYY-MM-DD 형식 (예: 2026-01-20)", 내용="목표 내용", 사진인증="인증 방식")
@app_commands.choices(사진인증=PHOTO_CHOICES)
async def plan_deadline(interaction: discord.Interaction, 마감일: str, 내용: PlanText, 사진인증: app_commands.Choice[int]):
    try:
        datetime.strptime(마감일, "%Y-%m-%d")
    except ValueError:
        await interaction.response.send_message("❌ 날짜 형식이 틀렸어요! **2026-01-20** 처럼 적어주세요.", ephemeral=True)
        return

    photo = bool(사진인증.value)
    plan = {"type": "목표", "deadline": 마감일, "content": 내용, "photo": photo, "completed": False}
    if await register_plan(interaction, "OneTime", plan):
        await interaction.response.send_message(f"🎯 **[목표] 등록 완료!** ({photo_icon(photo)})\n- **마감:** {마감일}까지\n- **내용:** {내용}")

#요일 계획
@plan_group.command(name="요일", description="특정 요일에만 반복할 계획을 세웁니다.")
@app_commands.describe(내용="내용", 요일="예: 월수금, 토일 (원하는 요일을 붙여서 적으세요)", 사진인증="사진 인증 여부 선택")
@app_commands.choices(사진인증=PHOTO_CHOICES)
async def plan_routine(interaction: discord.Interaction, 내용: PlanText, 요일: str, 사진인증: app_commands.Choice[int]):
    # 입력한 글자에서 요일만 뽑아내기 (예: "월수금" → ["월", "수", "금"])
    selected_days = [day for day in WEEKDAY_NAMES if day in 요일]
    if not selected_days:
        await interaction.response.send_message("❌ 요일을 제대로 인식하지 못했어요! **'월수금'**, **'토일'** 처럼 요일 글자를 포함해서 적어주세요.", ephemeral=True)
        return

    photo = bool(사진인증.value)
    plan = {"type": "요일", "content": 내용, "photo": photo, "days": selected_days}
    if await register_plan(interaction, "Routine", plan):
        await interaction.response.send_message(f"✅ **[요일] 계획 등록 완료!** ({photo_icon(photo)})\n- **내용:** {내용}\n- **수행 요일:** {', '.join(selected_days)}요일")

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
        deleted_count = 0
        
        for cat in PLAN_CATEGORIES:
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

#자동완성 (인증할 수 있는 계획만 보여줌)
async def plan_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    user_id = str(interaction.user.id)
    if user_id not in user_plans:
        return []

    base_date = get_base_date()
    cmd_name = interaction.command.name if interaction.command else "인증"
    target_date = base_date - timedelta(days=1) if cmd_name == "어제인증" else base_date
    target_date_str = target_date.strftime('%Y-%m-%d')

    choices = []
    for category, plan in iter_plans(user_plans[user_id]):
        history = plan.get('history', [])
        if target_date_str in history: continue  # 그날 이미 인증함

        if category == "Daily":
            tag = "일일"

        elif category == "Routine":
            tag = "요일"
            plan_days = plan.get('days', [])
            # 지정된 요일이 있고, 오늘(어제)이 그 요일이 아니면 목록에서 제외
            if plan_days and WEEKDAY_NAMES[target_date.weekday()] not in plan_days:
                continue

        elif category == "Weekly":
            final_target = get_weekly_target(user_id, plan, target_date)
            if count_in_week(history, target_date) >= final_target: continue
            tag = f"주{final_target}회"

        elif category == "Monthly":
            if count_in_month(history, target_date) >= get_monthly_target(user_id, plan, target_date): continue
            tag = "월간"

        elif category == "Interval":
            interval = plan.get('interval', 1)
            if history:
                diff = (datetime.strptime(target_date_str, "%Y-%m-%d") - datetime.strptime(history[-1], "%Y-%m-%d")).days
                if diff < interval:
                    tag = f"{interval}일장/D-{interval-diff}"
                elif diff == interval:
                    tag = f"{interval}일장/오늘마감"
                else:
                    tag = f"{interval}일장/D+{diff-interval}"
            else:
                tag = f"{interval}일장/시작전"

        else:  # OneTime
            if plan.get('completed', False): continue  # 이미 완료된 건 추천에 안 띄우기
            tag = f"~{plan.get('deadline', '날짜미정')}"

        photo_mark = "📸 " if plan.get('photo') else ""
        name = f"[{tag}] {photo_mark}{plan['content']}"
        if current.lower() in name.lower() and len(plan['content']) <= 100:
            choices.append(app_commands.Choice(name=fit_choice(name), value=plan['content']))

    return choices[:25]

#자동완성(삭제) - 모든 계획을 보여줌
async def plan_autocomplete_delete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    user_id = str(interaction.user.id)
    choices = []

    for category, plan in iter_plans(user_plans.get(user_id, {})):
        if category == "Weekly": tag = f"주{plan.get('count', 1)}회"
        elif category == "Interval": tag = f"{plan.get('interval', 1)}일장"
        else: tag = CATEGORY_KR[category]

        name = f"[{tag}] {plan['content']}"
        if current.lower() in name.lower() and len(plan['content']) <= 100:
            choices.append(app_commands.Choice(name=fit_choice(name), value=plan['content']))

    return choices[:25]

#계획 삭제
@plan_group.command(name="삭제", description="등록된 계획 중 하나를 선택해 삭제합니다.")
@app_commands.describe(계획="삭제할 계획을 선택하세요?")
@app_commands.autocomplete(계획=plan_autocomplete_delete)
async def plan_delete(interaction: discord.Interaction, 계획: str):
    user_id = str(interaction.user.id)
    category, plan = find_plan(user_id, 계획)

    if not plan:
        await interaction.response.send_message(f"❓ **'{계획}'**라는 계획을 못 찾겠어요. 이미 삭제됐나 봐요!", ephemeral=True)
        return

    plans = user_plans[user_id][category]
    plans.remove(plan)
    if not plans:
        del user_plans[user_id][category]

    await save_data(user_plans)
    await interaction.response.send_message(f"🗑️ **[{CATEGORY_KR[category]}] {계획}** 계획을 시원하게 삭제했습니다! 👋")

bot.tree.add_command(plan_group)

# --- 면책 ---
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
        self.target_id = target_id
        self.target_dates = [target_dates] if isinstance(target_dates, str) else target_dates

        self.agreed_users = set(agreed_users) # 찬성 명단
        self.denied_users = set(denied_users) # 반대 명단
        self.total_members = total_members
        self.required_votes = required_votes
        self.eligible_voters = set(eligible_voters) if eligible_voters is not None else None

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
        if self.message_id in active_votes:
            active_votes[self.message_id]['agreed_users'] = list(self.agreed_users)
            active_votes[self.message_id]['denied_users'] = list(self.denied_users)
            await save_vote_data(active_votes)

    async def finish_vote(self):
        if self.message_id in active_votes:
            del active_votes[self.message_id]
            await save_vote_data(active_votes)

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
        exemptions = user_plans.setdefault(str(self.target_id), {}).setdefault('exemptions', [])
        new_dates = [d for d in self.target_dates if d not in exemptions]
        if new_dates:
            exemptions.extend(new_dates)
            await save_data(user_plans)
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

def get_eligible_voters(guild, requester_id):
    """투표할 수 있는 사람: 서버에 있는 사람 중 계획을 하나라도 등록한 참가자 (요청자, 봇 제외)"""
    voters = []
    for member in guild.members:
        if member.bot or member.id == requester_id:
            continue
        if any(True for _ in iter_plans(user_plans.get(str(member.id), {}))):
            voters.append(member.id)
    return voters

async def start_immunity_vote(interaction: discord.Interaction, dates: list, title: str, color: discord.Color, date_field: tuple, 사유: str):
    """면책 투표 메시지를 만들고 저장함 (/면책, /면책기간 공통)"""
    requester_id = interaction.user.id
    voters = get_eligible_voters(interaction.guild, requester_id)

    if not voters:
        await interaction.response.send_message("❌ 투표해 줄 다른 참가자가 없어요! (계획을 등록한 다른 멤버가 있어야 해요)", ephemeral=True)
        return

    # 요청자를 뺀 참가자의 과반수
    required_votes = len(voters) // 2 + 1

    embed = discord.Embed(title=title, description=f"**{interaction.user.display_name}**님이 면책을 요청했습니다.", color=color)
    embed.add_field(name=date_field[0], value=date_field[1], inline=False)
    embed.add_field(name="📝 사유", value=사유, inline=False)
    embed.set_footer(text=f"참가자 {len(voters)}명 중 과반수인 {required_votes}명의 동의가 필요합니다.")

    await interaction.response.send_message(content="@everyone", embed=embed)
    message = await interaction.original_response()

    view = ImmunityView(message.id, requester_id, dates, [], [], len(voters) + 1, required_votes, voters)
    await interaction.edit_original_response(view=view)

    # 재부팅 때 버튼을 복구할 수 있도록 저장
    active_votes[str(message.id)] = {
        "target_id": requester_id,
        "target_dates": dates,
        "agreed_users": [],
        "denied_users": [],
        "total_members": len(voters) + 1,
        "required_votes": required_votes,
        "eligible_voters": voters,
    }
    await save_vote_data(active_votes)

# --- 면책 요청 ---
@bot.tree.command(name="면책", description="개인 사정으로 인한 오늘 벌금 면제를 요청합니다 (참가자 과반수 동의 필요).")
@app_commands.describe(사유="면책을 요청하는 합당한 사유를 적어주세요.")
@app_commands.guild_only()
async def request_immunity(interaction: discord.Interaction, 사유: LongText):
    # 새벽 0~5시에 요청하면 전날 기준 (인증/정산과 같은 기준)
    target_str = get_base_date().strftime('%Y-%m-%d')
    await start_immunity_vote(interaction, [target_str], "🛡️ 면책 요청합니다!", discord.Color.orange(), ("📅 날짜", target_str), 사유)

#---면책기간---
@bot.tree.command(name="면책기간", description="특정 기간 동안의 벌금 면제를 요청합니다 (참가자 과반수 동의 필요).")
@app_commands.describe(시작일="YYYY-MM-DD", 종료일="YYYY-MM-DD", 사유="면책 사유")
@app_commands.guild_only()
async def request_immunity_period(interaction: discord.Interaction, 시작일: str, 종료일: str, 사유: LongText):
    try:
        start_dt = datetime.strptime(시작일, "%Y-%m-%d")
        end_dt = datetime.strptime(종료일, "%Y-%m-%d")
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

    date_list = [(start_dt + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
    period_str = f"{시작일} ~ {종료일} (**총 {days}일**)"
    await start_immunity_vote(interaction, date_list, "🛡️ 장기 면책 요청합니다!", discord.Color.purple(), ("📅 기간", period_str), 사유)

#휴식 (월 1회)
@bot.tree.command(name="휴식", description="한 달에 한 번, 오늘을 휴식일로 지정합니다. (벌금 면제)")
async def take_rest(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    
    if user_id not in user_plans:
        user_plans[user_id] = {}

    # 1. 날짜 계산 (새벽 0~5시는 전날)
    target_date = get_base_date()
    note = "(새벽🌙)" if get_now().hour < 6 else ""
    target_date_str = target_date.strftime('%Y-%m-%d')

    # 2. 이번 달에 쓴 적 있는지 확인
    rest_history = user_plans[user_id].setdefault('rest_history', [])
    if count_in_month(rest_history, target_date) > 0:
        await interaction.response.send_message("❌ **이번 달 휴식권을 이미 사용하셨어요!** (월 1회 제한)", ephemeral=True)
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

    # 1. 취소할 날짜 계산 (휴식 사용과 같은 새벽 기준)
    target_date_str = get_base_date().strftime('%Y-%m-%d')
    
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
# 자동완성: 주간 계획만 보여줌 (이번 주 목표를 이미 채운 계획도 포함)
async def weekly_plan_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    user_id = str(interaction.user.id)
    choices = []
    for _, plan in iter_plans(user_plans.get(user_id, {}), categories=["Weekly"]):
        name = f"[주{plan.get('count', 1)}회] {plan['content']}"
        if current.lower() in name.lower() and len(plan['content']) <= 100:
            choices.append(app_commands.Choice(name=fit_choice(name), value=plan['content']))
    return choices[:25]

# 이번 주 한정 목표 수정 명령어
@bot.tree.command(name="이번주목표", description="이번 주만 적용될 주간 목표 횟수를 수정합니다.")
@app_commands.describe(계획="수정할 주간 계획 선택", 횟수="이번 주에 적용할 목표 횟수 (0이면 면제)")
@app_commands.autocomplete(계획=weekly_plan_autocomplete)
async def set_weekly_override(interaction: discord.Interaction, 계획: str, 횟수: app_commands.Range[int, 0, 7]):
    user_id = str(interaction.user.id)
    category, target_plan = find_plan(user_id, 계획)

    if category != "Weekly":
        await interaction.response.send_message("❌ 해당 주간 계획을 찾을 수 없습니다.", ephemeral=True)
        return

    # 이번 주 월요일 날짜를 키(Key)로 사용 (새벽 0~5시는 전날 기준)
    start_of_week_str, _ = week_bounds(get_base_date())

    # 데이터 저장 구조: 'overrides': {'2026-02-09': 3}
    target_plan.setdefault('overrides', {})[start_of_week_str] = 횟수
    await save_data(user_plans)

    embed = discord.Embed(title="📅 이번 주 목표 수정 완료", color=discord.Color.orange())
    embed.description = f"**{계획}**의 이번 주 목표를 **{횟수}회**로 변경했습니다.\n(다음 주가 되면 원래대로 돌아갑니다.)"
    
    await interaction.response.send_message(embed=embed)

#현황
@bot.tree.command(name="현황", description="이번 달 멤버들의 휴식 및 면책 사용 내역을 확인합니다.")
@app_commands.guild_only()
async def check_monthly_status(interaction: discord.Interaction):
    now = get_base_date()  # 새벽 0~5시는 전날 기준
    this_month_str = now.strftime('%Y-%m') # 예: 2026-01
    
    description = "이번 달 휴식 및 면책 사용 기록입니다."
    fields = []
    
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
        
        fields.append((f"👤 {member.display_name}", f"{rest_txt}\n{imm_txt}", False))

    if not has_data:
        description = "✨ 이번 달은 아직 휴식이나 면책을 쓴 사람이 없네요! 성실해요! 🔥"

    embeds = build_embeds(
        title=f"📊 {now.month}월 현황판",
        color=discord.Color.blurple(),
        description=description,
        fields=fields,
        footer=f"기준: {now.strftime('%Y년 %m월')}",
    )
    await respond_embeds(interaction, embeds)

#인증 처리
def plan_progress_line(user_id, category, plan, target_date):
    """인증 후 '현재 진행 상황'에 보여줄 (표시, 설명) 한 줄"""
    target_date_str = target_date.strftime('%Y-%m-%d')
    history = plan.get('history', [])
    if 'last_verified' in plan and not history:
        history = [plan['last_verified']]  # 구버전 데이터 호환

    if category in ("Daily", "Routine"):
        mark = "✅" if target_date_str in history else "⬜"
        return mark, "[매일]" if category == "Daily" else "[요일]"

    if category in ("Weekly", "Monthly"):
        if category == "Weekly":
            count = count_in_week(history, target_date)
            target = get_weekly_target(user_id, plan, target_date)
        else:
            count = count_in_month(history, target_date)
            target = get_monthly_target(user_id, plan, target_date)

        if count >= target: mark = "✅"                  # 목표 달성
        elif target_date_str in history: mark = "☑️"     # 오늘은 인증함
        else: mark = "⬜"
        return mark, f"[{count}/{target}회]"

    if category == "Interval":
        interval = plan.get('interval', 2)
        text = f"[{interval}일장]"
        if not history:
            return "🚨", text
        if history[-1] == target_date_str:
            return "✅", text + "(완료)"
        diff = (datetime.strptime(target_date_str, "%Y-%m-%d") - datetime.strptime(history[-1], "%Y-%m-%d")).days
        if diff > interval: return "🚨", text + f"(D+{diff-interval})"
        if diff == interval: return "🔥", text + "(오늘 마감!)"
        return "💤", text + f"(D-{interval-diff})"

    # OneTime
    if plan.get('completed', False):
        return "🏆", "[목표달성]"
    deadline = plan.get('deadline', '9999-12-31')
    days_left = (datetime.strptime(deadline, "%Y-%m-%d") - datetime.strptime(target_date_str, "%Y-%m-%d")).days
    if days_left < 0: return "💀", f"[마감지남 D+{abs(days_left)}]"
    if days_left == 0: return "🔥", "[오늘마감]"
    return "⏳", f"[D-{days_left}]"

async def process_verification(interaction: discord.Interaction, 계획:str, 내용: str, 사진: discord.Attachment, is_yesterday: bool):
    # content_type이 비어 있는(None) 첨부 파일도 있어서 안전하게 확인
    if 사진 and not (사진.content_type or "").startswith("image/"):
        await interaction.response.send_message("❌ 사진 파일만 올릴 수 있어요!", ephemeral=True)
        return

    base_date = get_base_date()  # 새벽 0~5시는 전날
    if is_yesterday:
        target_date = base_date - timedelta(days=1)
        display_note = "(어제 늦은 인증😅)"
    else:
        target_date = base_date
        display_note = "(새벽🌙)" if get_now().hour < 6 else ""
    target_date_str = target_date.strftime('%Y-%m-%d')

    user_id = str(interaction.user.id)
    category, plan = find_plan(user_id, 계획)

    # 1. 인증 전에 확인 (조건이 안 맞으면 아무것도 저장하지 않음)
    if not plan:
        await interaction.response.send_message("❌ 해당 계획을 찾을 수 없어요! 목록에서 선택해주세요.", ephemeral=True)
        return

    if category == "Routine":
        target_weekday = WEEKDAY_NAMES[target_date.weekday()]
        if plan.get('days') and target_weekday not in plan['days']:
            await interaction.response.send_message(f"❌ **'{계획}'**은(는) **{target_weekday}요일**에 하는 날이 아닙니다!", ephemeral=True)
            return

    if plan.get('photo') and not 사진:
        await interaction.response.send_message(f"📸 **'{계획}'**은(는) 사진 인증이 필요한 계획이에요! `사진` 칸에 인증샷을 첨부해주세요.", ephemeral=True)
        return

    # 2. 인증 기록
    history = plan.setdefault('history', [])
    if target_date_str not in history:
        history.append(target_date_str)
        history.sort()
    plan['last_verified'] = target_date_str

    if category == "OneTime":
        plan['completed'] = True
        verified_plan_name = f"[목표달성] {plan['content']}"
    else:
        verified_plan_name = f"[{CATEGORY_KR[category]}] {plan['content']}"

    await save_data(user_plans)

    # 3. 현재 진행 상황
    plan_text_list = []
    for cat, p in iter_plans(user_plans[user_id]):
        mark, text = plan_progress_line(user_id, cat, p, target_date)
        content_display = f"**{p['content']}**" if p['content'] == 계획 else p['content']
        plan_text_list.append(f"{mark} {text} {content_display}")

    final_text = "\n".join(plan_text_list) if plan_text_list else "계획 없음"

    fields = [
        ("방금 인증함", verified_plan_name, False),
        ("인증 기준일", f"{target_date_str} {display_note}", False),
    ]
    if 내용: fields.append(("코멘트", 내용, False))
    fields.append(("📅 현재 진행 상황", final_text, False))

    embeds = build_embeds(
        title="🔥 인증 현황",
        color=discord.Color.green(),
        fields=fields,
        image_url=사진.url if 사진 else None,
    )
    await respond_embeds(interaction, embeds)

#계획 인증(오늘)
@bot.tree.command(name="인증", description="한 내용을 인증하세요")
@app_commands.describe(계획="인증할 계획 선택", 내용="코멘트 (선택)", 사진="인증샷 (선택)")
@app_commands.autocomplete(계획=plan_autocomplete)
async def verify_study(interaction: discord.Interaction, 계획:str, 내용: LongText=None, 사진: discord.Attachment=None):
    await process_verification(interaction, 계획, 내용, 사진, is_yesterday=False)

#계획 인증(어제)
@bot.tree.command(name="어제인증", description="깜빡한 어제 계획을 인증합니다.")
@app_commands.describe(계획="인증할 계획 선택", 내용="코멘트 (선택)", 사진="인증샷 (선택)")
@app_commands.autocomplete(계획=plan_autocomplete)
async def verify_study_yesterday(interaction: discord.Interaction, 계획:str, 내용: LongText=None, 사진: discord.Attachment=None):
    await process_verification(interaction, 계획, 내용, 사진, is_yesterday=True)

#계획표
CATEGORY_TITLES = {
    "Daily": "🌞 매일 (Daily)",
    "Routine": "🔄 요일 (Routine)",
    "Weekly": "📅 주간 (Weekly)",
    "Monthly": "🗓️ 월간 (Monthly)",
    "Interval": "🔁 반복 (Interval)",
    "OneTime": "🎯 목표 (One-Time)"
}

def plan_status_line(user_id, category, plan, display_date):
    """계획표에 보여줄 한 줄"""
    today_str = display_date.strftime('%Y-%m-%d')
    history = plan.get('history', [])
    content = plan['content']

    if category == "Daily":
        if today_str in history:
            return f"✅ ~~{content}~~ (완료)"
        return f"⬜ {content}"

    if category == "Routine":
        plan_days = plan.get('days', [])
        day_badge = f" ({', '.join(plan_days)})" if plan_days else " (요일 미지정)"
        if today_str in history:
            return f"✅ ~~{content}~~{day_badge} (완료)"
        if plan_days and WEEKDAY_NAMES[display_date.weekday()] not in plan_days:
            return f"💤 {content}{day_badge} (쉬는 날)"
        return f"⬜ {content}{day_badge}"

    if category in ("Weekly", "Monthly"):
        original_target = plan.get('count', 1)
        if category == "Weekly":
            current_count = count_in_week(history, display_date)
            real_target = get_weekly_target(user_id, plan, display_date)
        else:
            current_count = count_in_month(history, display_date)
            real_target = get_monthly_target(user_id, plan, display_date)

        target_display = f"{real_target}회 (📉원래 {original_target}회)" if real_target < original_target else f"{real_target}회"
        progress = f"({current_count}/{target_display})"

        if current_count >= real_target:
            return f"✅ ~~{content}~~ {progress}"
        if today_str in history:
            return f"☑️ {content} {progress}"
        return f"⬜ {content} {progress}"

    if category == "Interval":
        interval = plan.get('interval', 2)
        if not history:
            return f"🚨 {content} (시작 전)"
        if history[-1] == today_str:
            return f"✅ ~~{content}~~ (오늘 완료)"
        diff = (datetime.strptime(today_str, "%Y-%m-%d") - datetime.strptime(history[-1], "%Y-%m-%d")).days
        if diff > interval: return f"🚨 {content} (마감지남 D+{diff-interval})"
        if diff == interval: return f"🔥 {content} (오늘 마감!)"
        return f"💤 {content} (D-{interval-diff})"

    # OneTime
    if plan.get('completed', False):
        return f"🏆 ~~{content}~~ (달성 완료!)"
    deadline = plan.get('deadline', '9999-12-31')
    days_left = (datetime.strptime(deadline, "%Y-%m-%d") - datetime.strptime(today_str, "%Y-%m-%d")).days
    if days_left < 0: return f"💀 {content} (마감 {abs(days_left)}일 지남)"
    if days_left == 0: return f"🔥 {content} (오늘 마감!)"
    return f"⏳ {content} (D-{days_left})"

@bot.tree.command(name="계획표", description="나의 계획과 달성 현황을 확인합니다.")
async def check_my_plans(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    user_data = user_plans.get(user_id, {})

    display_date = get_base_date()  # 새벽 0~5시는 전날
    note_date = "(새벽🌙)" if get_now().hour < 6 else ""
    today_str = display_date.strftime('%Y-%m-%d')

    fields = []
    for category in PLAN_CATEGORIES:
        lines = [plan_status_line(user_id, category, plan, display_date) for _, plan in iter_plans(user_data, categories=[category])]
        if lines:
            fields.append((CATEGORY_TITLES[category], "\n".join(lines), False))

    if not fields:
        await interaction.response.send_message("📭 등록된 계획이 없어요! `/계획 일일`, `/계획 주간` 같은 명령어로 추가해보세요.", ephemeral=True)
        return

    rest_cnt = count_in_month(user_data.get('rest_history', []), display_date)
    exempt_cnt = count_in_month(user_data.get('exemptions', []), display_date)

    embeds = build_embeds(
        title=f"📋 {interaction.user.display_name}님의 계획표",
        color=discord.Color.blue(),
        fields=fields,
        footer=f"기준: {today_str} {note_date} | 이번 달 휴식: {rest_cnt}회 / 면책: {exempt_cnt}회",
    )
    await respond_embeds(interaction, embeds)

#인증초기화
@bot.tree.command(name="인증초기화", description="[테스트용] 오늘의 모든 인증 도장을 지웁니다.")
async def reset_verification(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    if user_id not in user_plans:
        await interaction.response.send_message("❓ 등록된 계획이 없어서 초기화할 게 없네요.", ephemeral=True)
        return

    target_date_str = get_base_date().strftime('%Y-%m-%d')  # 새벽이면 어제 거를 지움

    count = 0
    for category, plan in iter_plans(user_plans[user_id]):
        # 1. history에서 오늘 날짜 제거
        if target_date_str in plan.get('history', []):
            plan['history'].remove(target_date_str)
            count += 1
            # 목표 계획이면 완료 상태도 취소
            if category == "OneTime":
                plan['completed'] = False

        # 2. last_verified가 오늘이면 삭제 (구버전 호환)
        if plan.get('last_verified') == target_date_str:
            del plan['last_verified']

    await save_data(user_plans)

    if count > 0:
        await interaction.response.send_message(f"🧹 **{target_date_str}** 날짜의 인증 도장 **{count}개**를 지웠습니다! ✨", ephemeral=True)
    else:
        await interaction.response.send_message(f"❓ **{target_date_str}** 날짜에 찍힌 도장이 없어요.", ephemeral=True)

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

#자동 백업 (하루 한 번, backups/날짜/ 폴더에 데이터 파일 복사)
BACKUP_DIR = BASE_DIR / "backups"
BACKUP_KEEP_DAYS = 14  # 최근 14일치만 보관

def _make_backup(date_str):
    folder = BACKUP_DIR / date_str
    folder.mkdir(parents=True, exist_ok=True)
    for path in (DATA_FILE, TIME_FILE, SESSION_FILE, VOTE_FILE, STATE_FILE):
        if path.exists():
            shutil.copy2(path, folder / path.name)

    # 오래된 백업 삭제 (날짜 이름 폴더만 대상)
    dated = sorted(p for p in BACKUP_DIR.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.name))
    for old in dated[:-BACKUP_KEEP_DAYS]:
        shutil.rmtree(old)

async def run_daily_backup(now):
    today_str = now.strftime('%Y-%m-%d')
    if bot_state.get("last_backup_date") == today_str:
        return
    # 저장은 항상 파일을 통째로 교체하는 방식이라, 복사하는 도중에 반쯤 쓰인 파일이 복사될 일은 없음
    await asyncio.get_running_loop().run_in_executor(None, _make_backup, today_str)
    bot_state["last_backup_date"] = today_str
    await save_state_data(bot_state)
    print(f"💾 데이터 백업 완료: backups/{today_str}/")

#감시자
@tasks.loop(minutes=60)
async def check_study_status():
    # 각 단계를 따로 감싸서, 한 곳에서 오류가 나도 반복 작업 자체는 멈추지 않게 함
    try:
        if await try_reset_daily_study():
            print("🌅 지능형 초기화 완료: 새로운 하루가 시작되었습니다.")
    except Exception:
        print("🚨 공부 시간 초기화 중 오류:")
        traceback.print_exc()

    now = get_now()
    check_target_str = get_base_date(now).strftime('%Y-%m-%d')
    print(f"⏰ 점검 중... {now.month}/{now.day} {now.hour}시 (인증기준: {check_target_str})")

    channel = bot.get_channel(ALERT_CHANNEL)
    if not channel:
        print("⚠️ 경고: ALERT_CHANNEL을 찾을 수 없어 정산/알림을 건너뜁니다. .env의 ID를 확인해주세요.")
        return

    try:
        await run_daily_settlement(channel, now)
    except Exception:
        print("🚨 벌금 정산 중 오류:")
        traceback.print_exc()

    try:
        await send_hourly_alerts(channel, now)
    except Exception:
        print("🚨 인증 알림 전송 중 오류:")
        traceback.print_exc()

    try:
        await run_daily_backup(now)
    except Exception:
        print("🚨 데이터 백업 중 오류:")
        traceback.print_exc()

def find_missed_plans(user_id, data, now, yesterday_str, is_monday, is_first_day):
    """어제(일일/요일/목표), 지난주(월요일), 지난달(1일) 기준으로 못 한 계획 목록을 돌려줌"""
    missed_details = []
    yesterday = now - timedelta(days=1)
    yesterday_weekday = WEEKDAY_NAMES[yesterday.weekday()]

    for category, plan in iter_plans(data):
        history = plan.get('history', [])
        created_at = plan.get('created_at', '2000-01-01')  # 예전 데이터는 등록일 없음 → 항상 검사

        # (1) 어제 '일일 계획'
        if category == "Daily":
            # 어제 이후에 등록한 계획은 어제 검사 대상이 아님
            if yesterday_str >= created_at and yesterday_str not in history:
                missed_details.append(f"[일일]{plan['content']}")

        # (2) 어제 '요일 계획' (어제 요일이 계획된 요일일 때만)
        elif category == "Routine":
            if yesterday_str >= created_at and yesterday_weekday in plan.get('days', []) and yesterday_str not in history:
                missed_details.append(f"[요일]{plan['content']}")

        # (3) [주간] 월요일이면 '지난주' 실적 체크 (지난주 중간에 만든 계획은 첫 주 제외)
        elif category == "Weekly" and is_monday:
            last_week_start_str, _ = week_bounds(yesterday)
            if created_at <= last_week_start_str:
                count = count_in_week(history, yesterday)
                # 화면에 보여주는 목표와 같은 기준 (휴식/면책 차감, /이번주목표 반영)
                target = get_weekly_target(user_id, plan, yesterday)
                if count < target:
                    missed_details.append(f"[주간]{plan['content']}({count}/{target}회)")

        # (4) [월간] 1일이면 '지난달' 실적 체크 (지난달 중간에 만든 계획은 첫 달 제외)
        elif category == "Monthly" and is_first_day:
            if created_at <= yesterday.strftime('%Y-%m-01'):
                count = count_in_month(history, yesterday)
                target = get_monthly_target(user_id, plan, yesterday)
                if count < target:
                    missed_details.append(f"[월간]{plan['content']}({count}/{target}회)")

        # (5) 마감일이 어제였고, 아직 완료하지 못한 목표
        elif category == "OneTime":
            if plan.get('deadline') == yesterday_str and not plan.get('completed', False):
                missed_details.append(f"[목표]{plan['content']}")

    return missed_details

async def run_daily_settlement(channel, now):
    """하루 한 번, SETTLEMENT_HOUR시 이후 처음 도는 시점에 어제 기록을 정산"""
    today_str = now.strftime('%Y-%m-%d')
    if now.hour < SETTLEMENT_HOUR or bot_state.get("last_settlement_date") == today_str:
        return

    yesterday_str = (now - timedelta(days=1)).strftime('%Y-%m-%d')
    is_monday = (now.weekday() == 0) # 월요일 (지난주 검사)
    is_first_day = (now.day == 1)    # 1일 (지난달 검사)

    fine_msg_list = []
    for user_id, data in list(user_plans.items()):
        if user_id == "system_data" or not isinstance(data, dict): continue

        try:
            missed_details = find_missed_plans(user_id, data, now, yesterday_str, is_monday, is_first_day)
        except Exception:
            # 한 사람 데이터가 이상해도 나머지 사람 정산은 계속 진행
            print(f"🚨 정산 중 오류 (유저 {user_id}), 이 유저는 건너뜁니다:")
            traceback.print_exc()
            continue

        if not missed_details: continue

        is_resting = yesterday_str in data.get('rest_history', [])
        is_exempt = yesterday_str in data.get('exemptions', [])

        if is_resting:
            fine_msg_list.append(f"🛌 <@{user_id}>님 **휴식권 사용!** (푹 쉬셨나요? 🍯)")
        elif is_exempt:
            fine_msg_list.append(f"🛡️ <@{user_id}>님 면책 통과! ({', '.join(missed_details)})")
        else:
            # 건수 상관없이 하루 고정 벌금
            data['fines'] = data.get('fines', 0) + FINE_AMOUNT
            fine_msg_list.append(f"💸 <@{user_id}>님 **{FINE_AMOUNT}원** 벌금! ({', '.join(missed_details)})")

    # 정산 완료 기록을 먼저 저장 → 이후 단계에서 문제가 생겨도 같은 날 벌금이 두 번 매겨지지 않음
    bot_state["last_settlement_date"] = today_str
    await save_state_data(bot_state)
    await save_data(user_plans)
    print(f"💸 {yesterday_str} 정산 완료 ({len(fine_msg_list)}건)")

    if not fine_msg_list:
        return

    # 정산 결과 및 랭킹 출력
    sorted_users = sorted(
        ((uid, udata) for uid, udata in user_plans.items() if isinstance(udata, dict)),
        key=lambda x: x[1].get('fines', 0), reverse=True
    )
    rank_lines = []
    for uid, udata in sorted_users:
        fine = udata.get('fines', 0)
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

def find_todo_plans(user_id, data, alert_date):
    """알림 날짜 기준으로 아직 인증 안 한 계획을 카테고리별로 모아서 돌려줌"""
    alert_date_str = alert_date.strftime('%Y-%m-%d')
    alert_weekday = WEEKDAY_NAMES[alert_date.weekday()]
    last_day_of_month = calendar.monthrange(alert_date.year, alert_date.month)[1]
    todo = {category: [] for category in PLAN_CATEGORIES}

    for category, plan in iter_plans(data):
        history = plan.get('history', [])
        done_today = alert_date_str in history

        # (1) 일일: 오늘 안 했으면 알림
        if category == "Daily":
            if not done_today:
                todo[category].append(plan['content'])

        # (2) 요일: 오늘이 계획된 요일이고 아직 안 했으면 알림
        elif category == "Routine":
            if alert_weekday in plan.get('days', []) and not done_today:
                todo[category].append(plan['content'])

        # (3) 주간: 금·토·일에만, 이번 주 목표를 아직 못 채웠으면 알림
        elif category == "Weekly":
            if alert_date.weekday() >= 4 and not done_today:
                cnt = count_in_week(history, alert_date)
                target = get_weekly_target(user_id, plan, alert_date)  # 휴식/면책이 있으면 줄어듦
                if target > 0 and cnt < target:
                    todo[category].append(f"{plan['content']}({cnt}/{target})")

        # (4) 월간: 20일, 25일, 말일에만, 이번 달 목표를 아직 못 채웠으면 알림
        elif category == "Monthly":
            if alert_date.day in (20, 25, last_day_of_month) and not done_today:
                cnt = count_in_month(history, alert_date)
                target = get_monthly_target(user_id, plan, alert_date)
                if target > 0 and cnt < target:
                    todo[category].append(f"{plan['content']}({cnt}/{target})")

        # (5) N일 간격: 간격이 다 찼으면 알림
        elif category == "Interval":
            interval = plan.get('interval', 1)
            if not history:
                todo[category].append(f"{plan['content']}(시작안함)")
            elif not done_today:
                diff = (alert_date.date() - datetime.strptime(history[-1], "%Y-%m-%d").date()).days
                if diff >= interval:
                    todo[category].append(f"{plan['content']}(D+{diff-interval})")

        # (6) 목표: 마감 3일 전부터 알림
        elif category == "OneTime":
            if not plan.get('completed', False):
                deadline = plan.get('deadline', '9999-12-31')
                days_left = (datetime.strptime(deadline, "%Y-%m-%d").date() - alert_date.date()).days
                if days_left == 0:
                    todo[category].append(f"🔥 {plan['content']}(오늘마감!)")
                elif 0 < days_left <= 3:
                    todo[category].append(f"⏳ {plan['content']}(D-{days_left})")

    return todo

async def send_hourly_alerts(channel, now):
    """각자 설정한 알림 시간(기본 2시)에 아직 인증 안 한 계획을 알려줌"""
    alert_date = get_base_date(now)  # 새벽 0~5시는 전날 기록을 검사
    alert_date_str = alert_date.strftime('%Y-%m-%d')

    # list()로 복사해서 순회 → 메시지 보내는 사이 새 유저가 생겨도 오류 없음
    for user_id, data in list(user_plans.items()):
        if not isinstance(data, dict): continue
        if data.get('alert_time', 2) != now.hour: continue

        # 휴식/면책 날에는 알림 안 보냄
        if alert_date_str in data.get('exemptions', []) or alert_date_str in data.get('rest_history', []):
            continue

        try:
            todo = find_todo_plans(user_id, data, alert_date)
        except Exception:
            # 한 사람 데이터가 이상해도 나머지 사람 알림은 계속 보냄
            print(f"🚨 알림 확인 중 오류 (유저 {user_id}), 이 유저는 건너뜁니다:")
            traceback.print_exc()
            continue

        if not any(todo.values()):
            continue

        msg = f"🔔 <@{user_id}>님! 인증할 시간이에요!\n"
        for category in PLAN_CATEGORIES:
            if todo[category]:
                msg += f"- **[{CATEGORY_KR[category]}]** {', '.join(todo[category])}\n"

        # 2000자가 넘으면 나눠서 보냄
        await send_long_message(channel, msg)

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
async def adjust_fine(interaction: discord.Interaction, 유저: discord.Member, 금액: int, 사유: LongText = "관리자 수정"):
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

#명령어 오류 공통 처리 (권한 없음, DM 사용, 예상 못 한 오류)
@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
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

#공부 시간 측정
@bot.event
async def on_voice_state_update(member, before, after):
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
@app_commands.checks.has_permissions(administrator=True)
async def send_notice(interaction: discord.Interaction, 제목: app_commands.Range[str, 1, 256], 내용: app_commands.Range[str, 1, 4000]):
    
    target_channel = bot.get_channel(ALERT_CHANNEL)

    if not target_channel:
        await interaction.response.send_message("❌ 공지 채널을 찾을 수 없어요! .env 파일의 ALERT_CHANNEL ID를 확인해주세요.", ephemeral=True)
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