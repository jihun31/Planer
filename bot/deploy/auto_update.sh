#!/usr/bin/env bash
# 돈까스봇 자동 업데이트 (systemd 타이머가 5분마다 실행)
#
# 1. GitHub(origin/main)에 새 커밋이 있는지 확인
# 2. bot/ 폴더가 바뀌었으면: 받기 → (requirements.txt가 바뀌었으면) 라이브러리 설치 → 문법 확인 → 봇 재시작
# 3. 재시작 후 봇이 정상으로 떠 있는지 확인. 실패하면 이전 버전으로 되돌리고 다시 켬
#    실패한 커밋은 기억해 두고, 다음 커밋이 올라올 때까지 다시 시도하지 않음
#
# 서버에서 직접 고친 파일이 있으면 덮어쓰지 않고 멈춤. .env·키·백업처럼 git이 관리하지 않는 파일은 건드리지 않음
set -uo pipefail

REPO_DIR="${TONKATSU_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# bash는 스크립트를 실행하면서 읽기 때문에, git reset이 이 파일을 바꾸면 중간부터 엉뚱하게 실행될 수 있음 → 복사본으로 실행
if [ -z "${TONKATSU_UPDATE_COPY:-}" ]; then
  copy="$(mktemp)"
  cp "${BASH_SOURCE[0]}" "$copy"
  TONKATSU_REPO_DIR="$REPO_DIR" TONKATSU_UPDATE_COPY="$copy" exec bash "$copy" "$@"
fi
trap 'rm -f "$TONKATSU_UPDATE_COPY"' EXIT
SERVICE="${TONKATSU_SERVICE:-tonkatsubot}"
BRANCH="${TONKATSU_BRANCH:-main}"
CHECK_WAIT="${TONKATSU_CHECK_WAIT:-40}"   # 재시작 후 이만큼(초) 기다렸다가 상태 확인
BOT_DIR="$REPO_DIR/bot"
PYTHON="$BOT_DIR/venv/bin/python"
STATE_DIR="$BOT_DIR/.auto-update"
FAILED_FILE="$STATE_DIR/failed-commit"

log() { echo "[auto-update] $*"; }

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "이미 실행 중이라 건너뜀"; exit 0; }

cd "$REPO_DIR" || exit 1

if ! git fetch --quiet origin "$BRANCH"; then
  log "GitHub에 접속하지 못함 (다음에 다시 시도)"
  exit 0
fi

current=$(git rev-parse HEAD)
target=$(git rev-parse "origin/$BRANCH")
[ "$current" = "$target" ] && exit 0

if [ -f "$FAILED_FILE" ] && [ "$(cat "$FAILED_FILE")" = "$target" ]; then
  exit 0  # 이 커밋은 이미 실패함. 새 커밋을 기다림
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "서버에서 직접 고친 파일이 있어서 업데이트하지 않음:"
  git status --short --untracked-files=no
  exit 1
fi

bot_changed=1
git diff --quiet "$current" "$target" -- bot && bot_changed=0
reqs_changed=1
git diff --quiet "$current" "$target" -- bot/requirements.txt && reqs_changed=0

# 강제로 덮어쓴(force push) 경우에도 맞춤
git reset --quiet --hard "$target"
log "코드 업데이트: ${current:0:7} → ${target:0:7}"

if [ "$bot_changed" = 0 ]; then
  log "봇 코드는 바뀌지 않아서 재시작하지 않음"
  exit 0
fi

rollback() {
  log "❌ $1 → 이전 버전(${current:0:7})으로 되돌림"
  echo "$target" > "$FAILED_FILE"
  git reset --quiet --hard "$current"
  if [ "$reqs_changed" = 1 ]; then
    "$PYTHON" -m pip install --quiet -r "$BOT_DIR/requirements.txt" || log "이전 라이브러리 재설치 실패"
  fi
  sudo -n systemctl restart "$SERVICE" || log "봇 재시작 실패"
  exit 1
}

if [ "$reqs_changed" = 1 ]; then
  log "requirements.txt가 바뀌어서 라이브러리 설치"
  "$PYTHON" -m pip install --quiet -r "$BOT_DIR/requirements.txt" || rollback "라이브러리 설치 실패"
fi

"$PYTHON" -m py_compile "$BOT_DIR"/*.py || rollback "문법 오류"

sudo -n systemctl restart "$SERVICE" || rollback "재시작 명령 실패"
sleep "$CHECK_WAIT"

state=$(systemctl show -p ActiveState --value "$SERVICE")
restarts=$(systemctl show -p NRestarts --value "$SERVICE")
if [ "$state" != "active" ] || [ "${restarts:-0}" != "0" ]; then
  rollback "재시작 후 봇이 정상 실행되지 않음 (상태: $state, 자동 재시작 ${restarts:-?}번)"
fi

rm -f "$FAILED_FILE"
log "✅ 봇 업데이트 완료: $(git log -1 --format='%h %s')"
