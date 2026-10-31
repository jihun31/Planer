"""bot/deploy/auto_update.sh를 임시 git 저장소에서 실제로 실행해 보는 테스트 (systemctl·sudo·pip는 가짜)"""
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy" / "auto_update.sh"
pytestmark = pytest.mark.skipif(shutil.which("flock") is None or shutil.which("git") is None, reason="flock/git 필요")

def sh(*args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

def write(path, text, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if mode:
        path.chmod(mode)

class Server:
    def __init__(self, tmp):
        self.tmp = tmp
        self.origin, self.dev, self.repo, self.bin = tmp / "origin.git", tmp / "dev", tmp / "server", tmp / "bin"
        self.log = tmp / "calls.log"
        self.state = tmp / "service-state"
        sh("git", "init", "-q", "--bare", "-b", "main", str(self.origin), cwd=tmp)
        sh("git", "clone", "-q", str(self.origin), str(self.dev), cwd=tmp)
        for args in (("user.email", "t@t"), ("user.name", "t")):
            sh("git", "config", *args, cwd=self.dev)
        write(self.dev / "README.md", "planer\n")
        write(self.dev / "bot" / "main.py", "print('v1')\n")
        write(self.dev / "bot" / "requirements.txt", "discord.py\n")
        write(self.dev / "bot" / "deploy" / "auto_update.sh", SCRIPT.read_text(encoding="utf-8"), 0o755)
        write(self.dev / ".gitignore", "bot/venv/\nbot/.auto-update/\n")
        self.push("v1")
        sh("git", "clone", "-q", str(self.origin), str(self.repo), cwd=tmp)
        # 가짜 venv python: pip는 기록만, 나머지는 진짜 파이썬
        write(self.repo / "bot" / "venv" / "bin" / "python",
              f'#!/bin/bash\nif [ "$1 $2" = "-m pip" ]; then echo "pip $*" >> "{self.log}"; exit ${{PIP_RC:-0}}; fi\nexec "{sys.executable}" "$@"\n', 0o755)
        write(self.bin / "sudo", '#!/bin/bash\n[ "$1" = "-n" ] && shift\nexec "$@"\n', 0o755)
        write(self.bin / "systemctl",
              f'#!/bin/bash\necho "systemctl $*" >> "{self.log}"\n'
              f'if [ "$1" = show ]; then source "{self.state}"; [ "$3" = ActiveState ] && echo "$ACTIVE" || echo "$NRESTARTS"; fi\n', 0o755)
        self.set_service("active", 0)

    def push(self, message, files=None):
        for name, text in (files or {}).items():
            write(self.dev / name, text)
        sh("git", "add", "-A", cwd=self.dev)
        sh("git", "commit", "-q", "--allow-empty", "-m", message, cwd=self.dev)
        sh("git", "push", "-q", "origin", "main", cwd=self.dev)
        return sh("git", "rev-parse", "HEAD", cwd=self.dev)

    def set_service(self, active, restarts):
        self.state.write_text(f"ACTIVE={active}\nNRESTARTS={restarts}\n")

    def run(self, **env):
        self.log.write_text("")
        result = subprocess.run(["bash", str(self.repo / "bot" / "deploy" / "auto_update.sh")], cwd=self.tmp,
                                capture_output=True, text=True,
                                env={**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "TONKATSU_CHECK_WAIT": "0", **env})
        return result.returncode, result.stdout + result.stderr, self.log.read_text()

    @property
    def head(self):
        return sh("git", "rev-parse", "HEAD", cwd=self.repo)

@pytest.fixture
def server(tmp_path):
    return Server(tmp_path)

def test_no_update_and_non_bot_changes(server):
    rc, out, calls = server.run()
    assert rc == 0 and calls == ""
    target = server.push("docs", {"README.md": "planer 2\n"})
    rc, out, calls = server.run()
    assert rc == 0 and server.head == target and "restart" not in calls and "재시작하지 않음" in out

def test_bot_change_restarts_and_checks_health(server):
    target = server.push("bot v2", {"bot/main.py": "print('v2')\n"})
    rc, out, calls = server.run()
    assert rc == 0, out
    assert server.head == target and "systemctl restart tonkatsubot" in calls and "pip" not in calls
    assert "✅ 봇 업데이트 완료" in out

def test_requirements_change_installs_libraries(server):
    server.push("deps", {"bot/requirements.txt": "discord.py\nrequests\n"})
    rc, out, calls = server.run()
    assert rc == 0 and "pip -m pip install --quiet -r" in calls

def test_syntax_error_rolls_back_and_waits_for_next_commit(server):
    good = server.head
    bad = server.push("broken", {"bot/main.py": "def broken(:\n"})
    rc, out, calls = server.run()
    assert rc == 1 and "문법 오류" in out
    assert server.head == good and (server.repo / "bot" / "main.py").read_text() == "print('v1')\n"
    assert (server.repo / "bot" / ".auto-update" / "failed-commit").read_text().strip() == bad
    assert "systemctl restart tonkatsubot" in calls  # 이전 버전으로 다시 켬
    # 같은 커밋은 다시 시도하지 않음
    rc, out, calls = server.run()
    assert rc == 0 and calls == "" and server.head == good
    # 고친 커밋이 올라오면 업데이트
    fixed = server.push("fixed", {"bot/main.py": "print('v3')\n"})
    rc, out, calls = server.run()
    assert rc == 0 and server.head == fixed
    assert not (server.repo / "bot" / ".auto-update" / "failed-commit").exists()

def test_unhealthy_after_restart_rolls_back(server):
    good = server.head
    server.set_service("activating", 2)
    server.push("crashes at runtime", {"bot/main.py": "raise SystemExit(1)\n"})
    rc, out, calls = server.run()
    assert rc == 1 and "정상 실행되지 않음" in out and server.head == good
    assert calls.count("systemctl restart tonkatsubot") == 2

def test_pip_failure_rolls_back(server):
    good = server.head
    server.push("bad deps", {"bot/requirements.txt": "nope==0\n", "bot/main.py": "print('x')\n"})
    rc, out, calls = server.run(PIP_RC="1")
    assert rc == 1 and "라이브러리 설치 실패" in out and server.head == good

def test_local_edits_are_never_overwritten(server):
    server.push("bot v2", {"bot/main.py": "print('v2')\n"})
    (server.repo / "bot" / "main.py").write_text("print('server hotfix')\n")
    rc, out, calls = server.run()
    assert rc == 1 and "직접 고친 파일" in out
    assert (server.repo / "bot" / "main.py").read_text() == "print('server hotfix')\n" and "restart" not in calls
    # git이 관리하지 않는 파일(.env 등)은 업데이트를 막지 않고, 지워지지도 않음
    sh("git", "checkout", "--", "bot/main.py", cwd=server.repo)
    (server.repo / "bot" / ".env").write_text("TOKEN=secret\n")
    rc, out, _ = server.run()
    assert rc == 0 and (server.repo / "bot" / ".env").read_text() == "TOKEN=secret\n"

def test_force_push_and_self_update(server):
    server.push("v2", {"bot/main.py": "print('v2')\n"})
    server.run()
    # 원격 기록을 덮어씀 (force push) + 스크립트 자신도 바뀜
    sh("git", "reset", "-q", "--hard", "HEAD~1", cwd=server.dev)
    write(server.dev / "bot" / "deploy" / "auto_update.sh",
          SCRIPT.read_text(encoding="utf-8").replace("봇 업데이트 완료", "봇 업데이트 완료!"), 0o755)
    write(server.dev / "bot" / "main.py", "print('rewritten')\n")
    sh("git", "commit", "-qam", "rewritten", cwd=server.dev)
    sh("git", "push", "-qf", "origin", "main", cwd=server.dev)
    rc, out, calls = server.run()
    assert rc == 0, out
    assert server.head == sh("git", "rev-parse", "HEAD", cwd=server.dev)
    assert (server.repo / "bot" / "main.py").read_text() == "print('rewritten')\n"
    assert stat.S_IMODE((server.repo / "bot" / "deploy" / "auto_update.sh").stat().st_mode) & 0o100
