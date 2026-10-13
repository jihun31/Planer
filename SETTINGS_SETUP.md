# 시간 관리 설정 활성화

설정은 Firebase의 plannerSettings에 사용자별 변경 이력으로 저장됩니다. 기존 기록은 수정하지 않습니다.

현재 CLI에 로그인된 계정은 프로젝트의 서버 규칙 조회 권한이 없어 규칙 자동 반영을 완료하지 못했습니다(403).

1. 기존 Planer 프로젝트 소유자 계정으로 Firebase Console을 엽니다.
2. Firestore Database → 규칙으로 이동합니다.
3. 기존 규칙은 유지하고, 아래 내용을 match /databases/{database}/documents { ... } 안에 추가합니다.
4. 게시 후 앱을 다시 실행합니다. 사용자 이름 옆 설정에서 시간을 변경합니다.

```text
match /plannerSettings/{settingId} {
  allow read: if request.auth != null && resource.data.uid == request.auth.uid;
  allow create: if request.auth != null && request.resource.data.uid == request.auth.uid
    && request.resource.data.keys().hasOnly(['uid', 'startHour', 'endHour', 'effectiveDate', 'changedAt', 'createdAt'])
    && request.resource.data.startHour is int && request.resource.data.startHour >= 0 && request.resource.data.startHour < 24
    && request.resource.data.endHour is int && request.resource.data.endHour >= 0 && request.resource.data.endHour < 24
    && request.resource.data.effectiveDate is string
    && request.resource.data.createdAt == request.time;
}
```

이전의 모든 경로에 대한 광범위한 허용 규칙이 있다면 사용자별 제한이 적용되지 않을 수 있습니다. 이 프로젝트의 firestore.rules는 사용자별 제한을 포함한 전체 규칙입니다.

변경은 오늘부터 적용되며 이전 날짜는 해당 날짜에 적용되던 설정을 유지합니다. 새벽 5시 전은 기존처럼 전날입니다. 범위를 줄여도 범위 밖의 기록이 있으면 그 시간까지 표가 확장됩니다. 타이머 기록도 범위 밖에서 잘리지 않습니다.

소스 실행은 최신 코드가 적용됩니다. 이미 설치한 배포판에는 새로 패키징한 설치 파일이 필요합니다.
