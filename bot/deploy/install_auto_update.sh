#!/usr/bin/env bash
# 자동 업데이트 설치 (서버에서 한 번만 실행): bash bot/deploy/install_auto_update.sh
#   끄기: sudo systemctl disable --now tonkatsubot-update.timer
#   로그: journalctl -u tonkatsubot-update -n 50
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE="tonkatsubot"
RUN_USER="$(id -un)"
SYSTEMCTL="$(command -v systemctl)"

if [ "$RUN_USER" = "root" ]; then
  echo "root가 아닌 봇 사용자(예: ubuntu)로 실행하세요." >&2; exit 1
fi
[ -x "$REPO_DIR/bot/venv/bin/python" ] || { echo "bot/venv가 없습니다. 먼저 봇을 설치하세요." >&2; exit 1; }
systemctl cat "$SERVICE" >/dev/null 2>&1 || { echo "$SERVICE 서비스가 없습니다." >&2; exit 1; }
chmod +x "$REPO_DIR/bot/deploy/auto_update.sh"

# 이 사용자가 봇 재시작만 비밀번호 없이 할 수 있게 (다른 sudo 권한은 주지 않음)
SUDOERS="$(mktemp)"
cat > "$SUDOERS" <<EOF
$RUN_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart $SERVICE
EOF
sudo visudo -cf "$SUDOERS" >/dev/null
sudo install -m 0440 "$SUDOERS" /etc/sudoers.d/tonkatsubot-update
rm -f "$SUDOERS"

sudo tee /etc/systemd/system/tonkatsubot-update.service >/dev/null <<EOF
[Unit]
Description=TonkatsuBot auto update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO_DIR
ExecStart=$REPO_DIR/bot/deploy/auto_update.sh
EOF

sudo tee /etc/systemd/system/tonkatsubot-update.timer >/dev/null <<EOF
[Unit]
Description=Check TonkatsuBot updates every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tonkatsubot-update.timer
echo "✅ 자동 업데이트를 켰어요. 5분마다 GitHub를 확인합니다."
echo "   상태: systemctl list-timers tonkatsubot-update.timer"
echo "   로그: journalctl -u tonkatsubot-update -n 50"
