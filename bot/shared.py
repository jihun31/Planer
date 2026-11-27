"""
봇 전체가 함께 쓰는 설정과 상태.
store와 bot_state는 main.py의 setup_hook이 채웁니다 (테스트에서는 직접 넣음).
다른 모듈에서는 `import shared` 후 `shared.store`처럼 읽어야 바뀐 값을 봅니다 (`from shared import store` 금지).
"""
import os
from datetime import timedelta
from pathlib import Path

from discord import app_commands
from dotenv import load_dotenv

import core
from core import day_str
from store import Store

# 이 파일이 있는 폴더. 어디서 실행하든 .env와 데이터 파일을 이 폴더에서 찾음
BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")
TOKEN = os.getenv('TOKEN')
if not TOKEN:
    raise RuntimeError(".env 파일에 TOKEN 값이 없습니다. .env.example을 참고해 추가해주세요.")

#채널 아이디 (.env 파일에서 불러옴)
def get_id_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f".env 파일에 {name} 값이 없습니다. .env.example을 참고해 추가해주세요.")
    try:
        return int(value)
    except ValueError:
        raise RuntimeError(f".env 파일의 {name} 값은 숫자 ID여야 합니다. (현재 값: {value!r})")

ALERT_CHANNEL = get_id_env('ALERT_CHANNEL')
WELCOME_CHANNEL = get_id_env('WELCOME_CHANNEL')

# 입력 글자 수 제한 (디스코드 표시 제한을 넘지 않도록)
PlanText = app_commands.Range[str, 1, 80]       # 계획 이름 (앱 규칙과 같은 1~80자)
LongText = app_commands.Range[str, 1, 1000]     # 사유/코멘트 (임베드 칸 최대 1024자)

#정산 설정
SETTLEMENT_HOUR = 12  # 매일 이 시각(이후)에 어제 기록을 정산
FINE_AMOUNT = 3000    # 벌금 3,000원

PHOTO_CHOICES = [
    app_commands.Choice(name="O (사진 필수)", value=1),
    app_commands.Choice(name="X (내용만 인증)", value=0)
]

# /인증, /인증취소의 '날짜' 옵션
DATE_CHOICES = [
    app_commands.Choice(name="오늘", value="today"),
    app_commands.Choice(name="어제 (깜빡한 인증)", value="yesterday"),
]

# Firestore 저장소와 정산·백업 기록
store: Store = None
bot_state = {}

#정산·백업 기록 (Firestore botState/state)
async def load_state():
    state = await store.get_state()
    if not isinstance(state, dict):
        # 처음 실행: 이미 12시가 지났으면 오늘 정산은 기존 봇이 했다고 보고 건너뜀 (중복 벌금 방지)
        now = core.get_now()
        last = now if now.hour >= SETTLEMENT_HOUR else now - timedelta(days=1)
        state = {"last_settlement_date": day_str(last)}
        await store.save_state(state)
    return state

async def save_state():
    await store.save_state(bot_state)
