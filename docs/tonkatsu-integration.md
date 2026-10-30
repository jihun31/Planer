# 돈까스봇 통합 설계

돈까스봇(디스코드 봇)을 이 저장소로 합치고, 봇과 Planer 앱이 **같은 Firestore 데이터베이스**를 쓰도록 바꾸는 설계입니다.
디스코드에서도, Planer 앱에서도 같은 계획을 인증할 수 있게 하는 것이 목표입니다.

> 상태: **설계 초안**. 아래 보안 규칙은 1단계에서 에뮬레이터 테스트와 함께 확정합니다.

## 1. 결정 사항

| 항목 | 결정 |
|---|---|
| 하루 기준 | **새벽 5시** (한국 시간). 0:00~4:59는 전날로 취급. 봇의 6시 기준을 5시로 바꿈 |
| 앱 사용 | **선택 사항**. 디스코드만으로 모든 기능을 쓸 수 있고, 앱은 PC 사용자를 위한 추가 수단 |
| 사진 인증 | **검수용**. 디스코드 인증 메시지에 첨부한 사진을 멤버들이 보고 확인. 사진 파일은 저장하지 않음 |
| 저장소 | `Planer-eddited`에 합침 (공개 저장소). 봇은 `bot/` 폴더 |

## 2. 역할 나누기

```
 디스코드 ──▶ 봇 (Oracle 서버, 관리자 권한) ──┐
                                               ├──▶ Firestore (planer-f8cb7)
 Planer 앱 (Google 로그인, 보안 규칙 적용) ────┘
```

- **봇이 서버 역할을 합니다.** 정산, 벌금, 면책 투표 결과, 계정 연동처럼 "누군가 판정해야 하는 일"은 봇만 씁니다.
- **앱은 본인 일만 씁니다.** 내 계획 등록·수정, 내 인증, 내 휴식권, 내 알림 시간. 보안 규칙이 이를 강제합니다.
- 봇은 Firebase 서비스 계정 키로 접속하므로 보안 규칙을 거치지 않습니다. 그래서 **봇 코드가 데이터 형식을 직접 지켜야** 합니다.

## 3. 사용자 식별

멤버의 기준 ID는 **디스코드 사용자 ID**입니다. 앱을 쓰는 사람만 Google 계정(Firebase uid)을 추가로 연결합니다.

### 계정 연동 흐름

1. 앱 설정에서 "디스코드 연동"을 누르면 앱이 8자리 연동 코드를 만들어 `linkCodes/{코드}`에 저장합니다.
2. 디스코드에서 `/연동 코드:ABCD2345`를 입력합니다.
3. 봇이 코드를 확인합니다. 10분 이내에 만들어졌는지, 명령어를 쓴 사람이 서버 멤버인지 봅니다. 확인되면 `links/{uid}`를 만들고 `members/{디스코드ID}.uid`를 채운 뒤 코드를 지웁니다.
4. 앱은 `links/{uid}`가 생긴 것을 보고 연동 완료를 표시합니다.

- 연동 해제는 디스코드 `/연동 해제`나 앱 설정에서 요청하고, 실제 처리는 봇이 합니다.
- 연동 전에는 앱에서 인증 관련 데이터를 볼 수 없습니다. 기존 Planer 개인 기능은 지금처럼 쓸 수 있습니다.
- 디스코드 쪽에서 신원을 확인하기 때문에, 앱에서 코드를 만든 사람이 디스코드에 직접 입력해야 연결됩니다.

## 4. 데이터 구조

모든 날짜는 `YYYY-MM-DD` 문자열이고, 5시 기준 날짜입니다. 시각은 Firestore `serverTimestamp()`로 저장합니다.

| 컬렉션 | 문서 ID | 내용 | 쓰는 쪽 | 읽는 쪽 |
|---|---|---|---|---|
| `members` | 디스코드 ID | `discordId`, `displayName`, `uid`(없으면 null), `alertHour`, `fines`(누적 합계 캐시), `createdAt` | 봇. 앱은 본인 `alertHour`만 | 연동된 멤버 |
| `links` | Firebase uid | `uid`, `discordId`, `linkedAt` | 봇 | 본인 |
| `linkCodes` | 연동 코드 | `uid`, `createdAt` | 앱 (본인 uid로만) | 봇 |
| `plans` | 자동 ID | 아래 "계획" 참고 | 봇, 앱 (본인 계획만) | 연동된 멤버 |
| `checkIns` | 아래 참고 | `planId`, `ownerId`, `date`, `source`(`discord`/`app`), `messageUrl`(디스코드만), `createdAt` | 봇, 앱 (본인, 사진 없는 계획만) | 연동된 멤버 |
| `offDays` | 아래 참고 | `ownerId`, `type`(`rest`/`exempt`), `date`, `createdAt` | 휴식: 봇·앱(본인). 면책: 봇 | 연동된 멤버 |
| `fineEvents` | 아래 참고 | `discordId`, `amount`(+/-), `reason`, `date`, `kind`(`settlement`/`admin`), `createdAt` | 봇 | 연동된 멤버 |
| `votes` | 디스코드 메시지 ID | 지금의 `active_votes.json` 항목 | 봇 | 연동된 멤버 |
| `botState` | `state` | 마지막 정산일, 마지막 백업일 | 봇 | 없음 |

### 계획 (`plans`)

| 필드 | 설명 |
|---|---|
| `ownerId` | 디스코드 ID |
| `category` | `Daily`, `Routine`, `Weekly`, `Monthly`, `Interval`, `OneTime`, `Limit` (지금 봇과 같음) |
| `content` | 1~80자 |
| `photo` | 사진 필수 여부 |
| `count` | 주간·월간 목표 횟수 |
| `period`, `limit` | 제한 계획의 기간(`day`/`week`/`month`)과 최대 횟수 |
| `days` | 요일 계획의 요일 목록 (`["월","수"]`) |
| `interval` | N일 계획의 간격 |
| `deadline` | 목표 계획의 마감일 |
| `startDate` | 등록일. 이전 기간은 정산하지 않음 (지금의 `created_at`) |
| `status` | `active`, `completed`(달성한 목표), `deleted` |
| `createdAt`, `updatedAt` | 서버 시각 |

- **계획은 지우지 않고 `status: deleted`로 바꿉니다.** 과거 인증 기록과 벌금 내역이 어떤 계획이었는지 남기기 위해서입니다.
- 디스코드 자동완성의 선택 값은 계획 이름 대신 **계획 ID**를 씁니다. 앱과 봇에서 동시에 같은 이름을 등록해도 헷갈리지 않습니다.

### 인증 기록 (`checkIns`)

인증 1번 = 문서 1개입니다. 지금 봇의 `history` 목록을 대신합니다.

- 제한 계획이 아니면 문서 ID를 `{planId}_{date}`로 고정합니다. 같은 날 두 번 인증하면 같은 문서라서 중복되지 않고, 앱과 봇이 동시에 인증해도 기록이 하나만 남습니다.
- 제한 계획은 자동 ID입니다. 같은 날 여러 번 기록할 수 있고, 문서 수가 곧 횟수입니다.
- 디스코드 인증은 `messageUrl`에 인증 메시지 링크를 저장합니다. 메시지 링크는 만료되지 않으므로 앱에서 누르면 사진이 있는 메시지로 바로 갑니다.
- **사진 필수 계획은 앱에서 인증할 수 없습니다.** 앱은 "디스코드에서 사진과 함께 인증해 주세요"라고 안내합니다.

### 휴식·면책 (`offDays`)

- 휴식: 문서 ID `{디스코드ID}_rest_{YYYY-MM}`. 한 달에 문서가 하나뿐이라 **월 1회 제한이 문서 ID로 강제**됩니다.
- 면책: 문서 ID `{디스코드ID}_exempt_{date}`. 투표가 통과하면 봇이 만듭니다.

### 벌금 내역 (`fineEvents`)

- 지금은 누적 합계만 있어서 "언제, 왜"를 알 수 없습니다. 앞으로는 벌금 1건 = 문서 1개로 남깁니다.
- 정산 문서 ID는 `settle_{date}_{디스코드ID}`입니다. 정산이 두 번 실행돼도 벌금이 두 번 생기지 않습니다.
- `/벌금수정`(±3,000원)은 `kind: admin` 문서를 만듭니다.
- `members.fines`는 화면 표시용 합계이고, 봇이 내역과 같은 트랜잭션에서 갱신합니다.

## 5. 날짜·시각 규칙

- 봇과 앱 모두 **한국 시간 기준 5시 경계**를 씁니다. 앱은 PC 시간대와 상관없이 한국 시간으로 계산하는 함수를 새로 둡니다. 기존 시간관리 탭의 `plannerDate`도 이미 5시 기준입니다.
- **앱 인증은 오늘·어제 날짜만 허용**합니다. PC 시계를 바꿔서 지난 날짜로 인증하는 것을 막기 위해, 보안 규칙이 서버 시각으로 날짜 범위를 검사합니다.
  - 날짜 D의 하루는 한국 시간 D일 05:00부터 D+1일 05:00까지, 즉 UTC로 `D 00:00 - 4시간`부터 `D 00:00 + 20시간`까지입니다.
  - 어제 인증까지 허용하므로, 규칙은 서버 시각이 `D 00:00(UTC) - 4시간` 이상, `+ 44시간` 미만인지 확인합니다.
- 정산은 지금처럼 매일 12시(한국 시간)에 봇이 합니다.

## 6. 보안 규칙 초안

기존 `firestore.rules`의 규칙은 그대로 두고 아래를 추가합니다. 에뮬레이터 테스트(`tests/firestore.rules.test.mjs`)와 함께 1단계에서 확정합니다.

```
function linked() {
  return signedIn() && exists(/databases/$(database)/documents/links/$(request.auth.uid));
}
function myDiscordId() {
  return get(/databases/$(database)/documents/links/$(request.auth.uid)).data.discordId;
}
function validDay(d) { return d is string && d.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'); }
// 한국 시간 5시 경계 기준 '오늘 또는 어제'
function recentDay(d) {
  let p = d.split('-');
  let start = timestamp.date(int(p[0]), int(p[1]), int(p[2]));
  return request.time >= start - duration.value(4, 'h')
      && request.time < start + duration.value(44, 'h');
}
// 한국 시간 5시 경계 기준 '오늘'
function todayDay(d) {
  let p = d.split('-');
  let start = timestamp.date(int(p[0]), int(p[1]), int(p[2]));
  return request.time >= start - duration.value(4, 'h')
      && request.time < start + duration.value(20, 'h');
}

match /links/{uid} {
  allow read: if signedIn() && uid == request.auth.uid;
}
match /linkCodes/{code} {
  allow create: if signedIn() && code.matches('^[A-HJ-NP-Z2-9]{8}$')
    && request.resource.data.keys().hasOnly(['uid', 'createdAt'])
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.createdAt == request.time;
  allow delete: if signedIn() && resource.data.uid == request.auth.uid;
}
match /members/{discordId} {
  allow read: if linked();
  allow update: if linked() && discordId == myDiscordId()
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['alertHour'])
    && request.resource.data.alertHour is int
    && request.resource.data.alertHour >= 0 && request.resource.data.alertHour <= 23;
}
match /plans/{planId} {
  allow read: if linked();
  allow create: if linked() && request.resource.data.ownerId == myDiscordId()
    && validPlan(request.resource.data) && request.resource.data.status == 'active'
    && request.resource.data.createdAt == request.time;
  allow update: if linked() && resource.data.ownerId == myDiscordId()
    && validPlan(request.resource.data)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['content', 'photo', 'count', 'limit', 'days', 'interval', 'deadline', 'status', 'updatedAt'])
    && request.resource.data.status in ['active', 'completed', 'deleted']
    && request.resource.data.updatedAt == request.time;
}
match /checkIns/{checkInId} {
  function plan() { return get(/databases/$(database)/documents/plans/$(request.resource.data.planId)).data; }
  allow read: if linked();
  allow create: if linked()
    && request.resource.data.keys().hasOnly(['planId', 'ownerId', 'date', 'source', 'createdAt'])
    && request.resource.data.ownerId == myDiscordId()
    && plan().ownerId == myDiscordId() && plan().status == 'active' && plan().photo == false
    && request.resource.data.source == 'app'
    && validDay(request.resource.data.date) && recentDay(request.resource.data.date)
    && (plan().category == 'Limit'
        || checkInId == request.resource.data.planId + '_' + request.resource.data.date)
    && request.resource.data.createdAt == request.time;
  allow delete: if linked() && resource.data.ownerId == myDiscordId() && recentDay(resource.data.date);
}
match /offDays/{offDayId} {
  allow read: if linked();
  allow create: if linked()
    && request.resource.data.keys().hasOnly(['ownerId', 'type', 'date', 'createdAt'])
    && request.resource.data.ownerId == myDiscordId()
    && request.resource.data.type == 'rest'
    && validDay(request.resource.data.date) && todayDay(request.resource.data.date)
    && offDayId == myDiscordId() + '_rest_'
         + request.resource.data.date.split('-')[0] + '-' + request.resource.data.date.split('-')[1]
    && request.resource.data.createdAt == request.time;
  allow delete: if linked() && resource.data.ownerId == myDiscordId()
    && resource.data.type == 'rest' && todayDay(resource.data.date);
}
match /fineEvents/{id} { allow read: if linked(); }
match /votes/{id}      { allow read: if linked(); }
// botState: 앱에서 접근 불가 (규칙 없음 = 거부)
```

`validPlan()`은 카테고리별 필수 필드와 범위를 검사합니다. 예를 들어 `content`는 1~80자, 주간 `count`는 1~7, `limit`은 0~50입니다. 1단계에서 작성합니다.

**확인할 점**
- 위 규칙에 따르면 연동된 멤버는 다른 멤버의 계획, 인증, 벌금을 볼 수 있습니다. 지금 디스코드 채널에서 서로 보이는 것과 같은 범위입니다.
- 연동되지 않은 Google 계정은 이 컬렉션을 전혀 읽을 수 없습니다. 연동은 디스코드 서버 멤버만 할 수 있습니다.
- 기존 개인 컬렉션(`goals`, `scheduleBlocks` 등)의 규칙은 바뀌지 않습니다.

## 7. 저장소 구조

```
Planer-eddited/
├─ bot/                      ← 돈까스봇 (TonkatsuBot 커밋 기록 그대로 가져옴)
│  ├─ main.py
│  ├─ requirements.txt       ← discord.py, python-dotenv, firebase-admin
│  ├─ .env.example
│  ├─ tools/migrate_json_to_firestore.py
│  └─ tests/
├─ src/features/checkins/    ← 앱 인증 탭 (4단계)
├─ firestore.rules           ← 공용 컬렉션 규칙 추가
├─ tests/firestore.rules.test.mjs
└─ docs/tonkatsu-integration.md
```

- 봇은 `git subtree add --prefix=bot`으로 가져와서 기존 커밋 기록을 유지합니다. TonkatsuBot 기록 전체에 토큰이나 채널 ID가 없는 것을 확인했습니다.
- Electron 설치 파일은 `dist/`와 `electron/`만 포함하므로 `bot/`은 설치본에 들어가지 않습니다.

## 8. 공개 저장소 보안 체크리스트

- [ ] `.gitignore`에 추가: `bot/.env`, `bot/*.json`(데이터·키), `bot/backups/`, `bot/venv/`, `__pycache__/`, `*-firebase-adminsdk-*.json`
- [ ] 서비스 계정 키는 서버의 저장소 밖 경로(예: `/home/ubuntu/secrets/`)에 `chmod 600`으로 두고, `.env`의 `FIREBASE_CREDENTIALS`로 경로만 지정
- [ ] 서비스 계정 권한은 Firestore 사용자 역할(`roles/datastore.user`)만 부여
- [ ] GitHub Actions에 비밀 정보 검사(gitleaks) 추가
- [ ] 보안 규칙 배포를 GitHub Actions로 자동화. 배포용 서비스 계정은 봇 계정과 분리
- [ ] Firebase 웹 설정(`src/firebase/config.js`)은 공개되어도 되는 값입니다. 데이터 보호는 보안 규칙이 담당
- [ ] Firestore 데이터(유저 ID, 벌금)는 저장소에 절대 커밋하지 않음. 봇 백업도 서버에만 저장

## 9. 단계별 작업

| 단계 | 작업 | 완료 기준 |
|---|---|---|
| **1. 규칙·구조** | 위 컬렉션 규칙 + `validPlan()` 작성, 에뮬레이터 테스트 (본인만 쓰기, 다른 멤버 쓰기 거부, 사진 계획 앱 인증 거부, 날짜 범위, 휴식 월 1회, 미연동 계정 거부) | `npm run test:rules` 통과 |
| **2. 봇 이전** | 봇 코드를 `bot/`으로 가져오기, 저장소를 JSON → Firestore로 교체(`firebase_admin.firestore_async`), 하루 기준 6시 → 5시, 자동완성 값을 계획 ID로, 이전 스크립트 작성 | 디스코드 기능이 지금과 똑같이 동작, 이전 스크립트 재실행해도 결과 동일 |
| **3. 연동** | `/연동` 명령어, 앱 설정의 연동 코드 화면 | 앱에서 코드 생성 → 디스코드 입력 → 앱에 연동 완료 표시 |
| **4. 앱 인증 탭** | 오프라인 저장 켜기(`persistentLocalCache`), 내 계획 목록·등록·삭제, 인증·취소, 제한 계획 횟수, 휴식권, 내 벌금 내역 | 앱 인증이 디스코드 `/계획표`에 바로 보임, 반대도 마찬가지 |
| **5. 편의 기능** | 공부방 음성 시간을 연동된 멤버의 앱 공부 기록(`scheduleBlocks`)에 저장, 공부 시간 목표 계획의 자동 인증, 앱에서 벌금 순위·이번 달 현황 보기 | 공부방에 있던 시간이 앱 통계와 메달에 반영 |
| **6. 운영** | 규칙 자동 배포, 봇의 일일 Firestore → JSON 백업, 서버 systemd 경로 변경, README 정리 | 서버에서 `git pull` + 재시작만으로 업데이트 |

### 데이터 이전 절차 (2단계)

1. 이전 스크립트를 `--dry-run`으로 실행해 옮겨질 개수를 확인합니다.
2. 봇을 끕니다 (`sudo systemctl stop tonkatsubot`).
3. 지금의 JSON 파일을 따로 복사해 둡니다.
4. 이전 스크립트를 실행합니다. 문서 ID를 고정 규칙으로 만들기 때문에 다시 실행해도 중복되지 않습니다.

   | 지금 데이터 | 옮겨갈 곳 |
   |---|---|
   | 계획 | `plans` |
   | `history` | `checkIns` |
   | `rest_history`, `exemptions` | `offDays` |
   | `fines` | `fineEvents` 1건 ("이전 누적 벌금") |
   | `alert_time` | `members.alertHour` |
   | `completed_goals` | `plans`(`status: completed`) |
   | `active_votes` | `votes` |

5. 새 봇을 켭니다.

**되돌리기:** 봇을 끄고 이전 커밋으로 되돌린 뒤, 3번에서 복사해 둔 JSON을 넣고 켜면 됩니다. 이전 작업은 JSON 파일을 바꾸지 않습니다.

## 10. 남은 위험과 결정할 것

- **앱 사용자 시간대:** 앱은 한국 시간 기준으로 계산합니다. 해외에서 앱을 쓰면 날짜가 현지 날짜와 다를 수 있습니다.
- **Firestore 무료 사용량:** 하루 읽기 5만, 쓰기 2만 회입니다. 정산 때 지난주·지난달 인증 기록을 읽으므로 멤버 수가 많아지면 사용량을 확인해야 합니다.
- **기존 "목표" 탭과의 관계:** 앱의 월간·주간 목표(O/X 체크)는 1차에서 그대로 두고, 인증 계획과는 별개로 둡니다.
- **봇 서버 시간:** 봇은 한국 시간을 직접 계산하므로 서버 시간대와 상관없습니다.
