# 시간 관리 설정 활성화

> **참고**: 실제 Firestore 보안 규칙의 원본은 저장소 루트의 [`firestore.rules`](./firestore.rules)입니다. 이 문서는 `match /plannerSettings/{settingId}` 블록을 참고하거나 수동으로 적용할 때 사용하는 안내입니다.

설정은 Firebase의 `plannerSettings` 컬렉션에 사용자별 변경 이력(append-only)으로 저장됩니다. 기존 기록은 수정하지 않습니다.

## Firebase 규칙 적용

1. 프로젝트 `planer-f8cb7` 소유자 계정으로 Firebase Console을 엽니다.
2. Firestore Database → 규칙으로 이동합니다.
3. 기존 규칙은 유지하고, 아래 내용을 `match /databases/{database}/documents { ... }` 안에 추가하거나 기존 `plannerSettings` 블록을 교체합니다.
4. 게시 후 앱을 다시 실행하고, 사용자 이름 옆 설정에서 시간 범위나 반대 기록 표시 방식을 변경합니다.

```text
    // Settings are append-only so earlier days retain their original range.
    match /plannerSettings/{settingId} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow create: if signedIn() && request.resource.data.uid == request.auth.uid
        && request.resource.data.keys().hasOnly(['uid', 'startHour', 'endHour', 'effectiveDate', 'changedAt', 'createdAt', 'plannerOppositeDisplay', 'controlOppositeDisplay'])
        && request.resource.data.startHour is int && request.resource.data.startHour >= 0 && request.resource.data.startHour < 24
        && request.resource.data.endHour is int && request.resource.data.endHour >= 0 && request.resource.data.endHour < 24
        && (!('plannerOppositeDisplay' in request.resource.data) || request.resource.data.plannerOppositeDisplay in ['all', 'faded', 'blind', 'hidden', 'transparent'])
        && (!('controlOppositeDisplay' in request.resource.data) || request.resource.data.controlOppositeDisplay in ['all', 'faded', 'blind', 'hidden', 'transparent'])
        && isDate(request.resource.data.effectiveDate)
        && (!('changedAt' in request.resource.data) || request.resource.data.changedAt is int)
        && request.resource.data.createdAt == request.time;
    }
```

- 위 블록은 `firestore.rules` 상단의 `signedIn()`과 `isDate(v)`(`YYYY-MM-DD` 형식 검사) 헬퍼 함수를 사용합니다.
- `plannerOppositeDisplay`, `controlOppositeDisplay`는 시간 관리·통제 탭에서 반대 영역 기록을 표시하는 방식(`all`, `faded`, `blind`, `hidden`, `transparent`)을 지정하는 선택 필드입니다.
- `effectiveDate`는 `YYYY-MM-DD` 형식의 문자열이어야 하며, `changedAt`은 포함 시 정수(`int`)여야 합니다.

이전의 모든 경로에 대한 광범위한 허용 규칙이 있다면 사용자별 제한이 적용되지 않을 수 있습니다. 이 프로젝트의 [`firestore.rules`](./firestore.rules)는 사용자별 제한을 포함한 전체 규칙입니다.

변경은 오늘부터 적용되며 이전 날짜는 해당 날짜에 적용되던 설정을 유지합니다. 새벽 5시 전은 기존처럼 전날입니다. 범위를 줄여도 범위 밖의 기록이 있으면 그 시간까지 표가 확장됩니다. 타이머 기록도 범위 밖에서 잘리지 않습니다.

소스 실행은 최신 코드가 적용됩니다. 로컬 설치본에 반영하려면 커밋 후 `npm run install:local`로 다시 설치합니다.
