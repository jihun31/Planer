# Planer (Planner)

**Planer**는 Electron + React + Firebase(Firestore) 기반의 개인 일정·시간 관리·습관·목표·메모·캘린더 데스크톱 앱이며, Discord 인증 봇인 **돈까스봇(`bot/`)**과 같은 Firestore 데이터베이스를 공유하는 통합 저장소입니다.

## 주요 구성

- **데스크톱 앱 (`src/`, `electron/`)**: React 19 + Vite + Electron 기반 UI
  - 오늘 할 일 · 하루 계획표(1분 격자 시간표 및 반복 루틴)
  - 시간 관리 · 통제 기록 및 월별 통계
  - 습관 관리 · 장기/세부 목표 · 캘린더 · 폴더 계층형 메모장
  - 돈까스봇 연동 인증 탭
- **돈까스 Discord 봇 (`bot/`)**: Python 기반 계획 인증·정산·벌금·휴식권 관리 봇
- **Firestore 보안 규칙 (`firestore.rules`)**: 사용자별 접근 제어 및 데이터 형식 검증 원본

## 주요 명령어

### 개발 실행

```bash
npm run dev           # Vite 개발 서버 실행 (http://localhost:5173)
npm run electron:dev  # Vite + Electron 데스크톱 앱 동시 실행
```

### 검사 및 빌드

```bash
npm run lint          # Oxlint 정적 검사
npm run build         # 프로덕션 번들 빌드 및 dist/build-info.json 생성
```

### 테스트

테스트 파일은 `scripts/test-files.mjs`가 `tests/` 아래의 이름 규칙(`*.test.mjs`/`*.test.cjs`, `*-dom.test.cjs`, `*.rules.test.mjs`)에 따라 자동으로 수집합니다.

```bash
npm run test:affected # 변경된 파일과 관련된 테스트만 선별 실행
npm test              # 전체 단위 테스트
npm run test:dom      # 전체 화면(DOM) 테스트
npm run test:rules    # 로컬 Firebase 에뮬레이터 Firestore 보안 규칙 테스트 (Java 21+ 필요)
npm run test:bot      # 로컬 Firebase 에뮬레이터 기반 돈까스봇(pytest) 테스트
```

### 로컬 설치 및 버전 확인

앱 버전은 `scripts/app-version.mjs`가 `package.json`의 앞 두 자리와 커밋 수로 자동 계산합니다.

```bash
npm run install:local # 커밋된 소스로 빌드 → 백업 → 로컬 설치본 교체 → 버전 검증 → 앱 재실행
npm run check:version # 설치된 앱 버전 및 빌드 지문 검증
```

## 관련 문서

- [firestore.rules](./firestore.rules) — Firestore 보안 규칙 원본
- [AGENTS.md](./AGENTS.md) — 저장소 작업·테스트·설치·배포 지침
- [docs/versioning.md](./docs/versioning.md) — 앱 버전 및 릴리스 검증 규칙
- [docs/tonkatsu-integration.md](./docs/tonkatsu-integration.md) — 돈까스봇 통합 설계
- [bot/README.md](./bot/README.md) — 돈까스 Discord 봇 사용법 및 명령어
- [DAY_PLANS_SETUP.md](./DAY_PLANS_SETUP.md) — 계획표 구조·규칙·검증 안내
- [SETTINGS_SETUP.md](./SETTINGS_SETUP.md) — 시간 관리 설정(`plannerSettings`) 규칙 안내
- [NOTEPAD_RULES.md](./NOTEPAD_RULES.md) — 메모·폴더(`notepads`) 규칙 안내
- [CALENDAR_SETUP.md](./CALENDAR_SETUP.md) — 캘린더(`calendarEvents`) 규칙 안내
- [SHARING.md](./SHARING.md) — Firebase 규칙 배포 및 Google 데스크톱 로그인 설정 안내
