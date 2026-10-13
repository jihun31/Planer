# 친구 공유 전 적용 안내

코드는 준비됐지만, 로컬 firestore.rules 파일을 만드는 것만으로 실제 Firebase 권한은 바뀌지 않습니다.
실제 Google 로그인도 발급된 데스크톱 OAuth 설정이 있어야 가능합니다.

## 1. Firebase 보안 규칙 적용

1. Firebase 콘솔에서 프로젝트 planer-f8cb7 선택.
2. Authentication → 사용자에서 본인 UID 확인.
3. Firestore Database → 데이터에서 기존 문서의 uid가 본인 UID인지 확인.
   uid 없는 기존 기록은 새 규칙에서 차단됩니다. 다른 사용자 소유로 임의 변경하지 마세요.
4. Firestore Database → 규칙에서 기존 규칙을 복사해 따로 보관.
5. 프로젝트 폴더의 firestore.rules 전체 내용을 규칙 편집기에 넣고 게시.
   기존의 allow read, write: if true 또는 request.auth != null 규칙을 남겨두지 마세요.
   여러 규칙 중 하나라도 허용하면 접근이 허용됩니다.
6. 수정된 앱을 재시작해 목표, 할 일, 활동의 조회·등록·삭제를 확인.

이 규칙은 모든 로그인 사용자가 자기 소유의 기록만 접근하도록 합니다.
허용된 친구 두 명만 로그인하도록 제한하는 초대제 규칙은 아닙니다.
Firebase 프로젝트 관리자는 콘솔에서 모든 사용자의 데이터를 볼 수 있습니다.

CLI 배포를 원한다면 계정 로그인 후 아래 명령으로 규칙만 게시할 수 있습니다.
다른 서비스 배포나 데이터 변경을 함께 실행하지 않습니다.

```powershell
npx firebase login
npx firebase deploy --only firestore:rules --project planer-f8cb7
```

## 2. Google 데스크톱 로그인 설정 (관리자가 한 번만)

1. Google Cloud 콘솔 https://console.cloud.google.com/ 에서 같은 프로젝트 planer-f8cb7 선택.
2. Google Auth Platform → 클라이언트 → 클라이언트 만들기.
   기존 UI라면 API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID.
3. 애플리케이션 유형: 데스크톱 앱. 이름: Planer Desktop.
4. 생성된 클라이언트의 JSON 파일을 다운로드.
5. 다운로드한 JSON을 이 프로젝트의 electron/google-oauth.json 로 저장.
   예제 파일 값을 임의로 채우지 말고 다운로드한 파일을 그대로 사용합니다.
   서비스 계정 키나 웹 애플리케이션용 클라이언트 파일이 아닙니다.
6. 동의 화면 설정이 필요한 경우 앱 이름·지원 이메일을 입력하고 외부 사용자 유형을 선택.
   테스트 사용자 등록이 필요한 상태라면 본인과 친구의 Google 이메일을 추가.
   요청 범위는 openid, email, profile뿐입니다. Drive/Gmail 권한은 필요 없습니다.
7. Firebase Authentication → 로그인 방법에서 Google 사용 설정 확인.
8. 앱을 완전히 종료 후 시작. Google 로그인 → 기본 브라우저 → 계정 선택 → 앱으로 복귀.

앱은 PKCE와 일회성 state, 127.0.0.1의 임시 포트로 인증을 받습니다.
별도의 서버, 유료 Cloud Functions, Firebase localhost 허용 도메인 추가는 이 데스크톱 방식에 필요하지 않습니다.
Google 액세스 토큰은 Firebase 인증에만 전달하며 디스크나 로그에 저장하지 않습니다.
Firebase가 반환한 사용자 세션은 기존 Firebase SDK가 관리합니다.
데스크톱 OAuth 클라이언트 설정은 설치본에 포함되며, 서버 관리자 자격 증명이 아닙니다.
친구는 이 설정을 직접 하지 않습니다.

## 3. 실제 계정/설치본 확인 (자동 테스트와 별도)

- 본인 계정으로 로그인 → 기존 기록이 그대로인지, Firebase UID가 바뀌지 않았는지 확인.
- 본인 계정 로그아웃 → 친구/테스트 계정 로그인 → 본인 기록이 보이지 않는지 확인.
- 두 번째 계정에서 목표·할 일·활동·타이머 기록 생성, 수정, 삭제.
- 본인 계정으로 돌아와 두 번째 계정 기록이 섞이지 않는지 확인.
- 타이머 정지 시 기록 1건만 저장되는지 확인.
- 개발 서버를 종료한 상태에서 설치본 로그인·앱 재시작·데이터 저장 확인.

설정 파일 준비 후 npm run electron:build 로 설치 파일을 만들 수 있습니다.
설치 파일 생성 자체는 실제 Google 인증 성공을 증명하지 않습니다.
설정 파일 없이 빌드하면 새 로그인 시 설정 필요 안내가 표시됩니다.

## 자동 검증

- npm test: 월별 읽기, 계정 전환, 소유자 조건, IPC 정리, 브라우저 로그인 수신 검증.
- npm run test:rules: 로컬 Firestore에서 가상 사용자 alice/bob와 비로그인 사용자를 검증.
- npm run build: 웹 화면 빌드.
- 규칙 테스트는 demo-planer-security 테스트 프로젝트만 사용하며 실서비스 데이터에 접근하지 않습니다.
- 에뮬레이터는 Java 21 이상이 필요합니다. 이 PC에는 C:\Program Files\Java\jdk-21.0.10 가 설치되어 있습니다.

공식 문서:
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/rules/unit-tests
- https://developers.google.com/identity/protocols/oauth2/native-app
