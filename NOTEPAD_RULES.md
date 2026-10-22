# 메모·폴더 Firebase 규칙 적용

Firebase 콘솔 → planer-f8cb7 → Firestore Database → 규칙에서 적용합니다.

- 이전 메모 규칙을 적용했다면 기존 `match /notepads/{userId}` 블록 전체를 아래 블록으로 교체하세요.
- 처음 적용한다면 기존 `match /databases/{database}/documents { ... }` 안쪽에 아래 블록을 추가하세요.
- 다른 기존 규칙은 유지하고, 적용 후 게시 버튼을 누르세요.
- 폴더 드래그 순서를 저장하려면 아래의 `sortOrder`가 포함된 규칙으로 갱신해야 합니다.
- 메모 영구 삭제와 기존 휴지통 정리에는 아래의 삭제 권한 및 `deleted` 규칙이 필요합니다. 적용 후 메모 탭을 열면 기존 휴지통의 메모가 영구 삭제됩니다.

```text
    match /notepads/{userId} {
      allow read: if signedIn() && userId == request.auth.uid;
      function validNotepad() {
        return request.resource.data.keys().hasOnly(['uid', 'text', 'revision', 'updatedAt', 'deleted'])
          && request.resource.data.uid == request.auth.uid
          && request.resource.data.text is string
          && request.resource.data.text.size() <= 50000
          && request.resource.data.revision is int
          && (!('deleted' in request.resource.data) || (request.resource.data.deleted == true && request.resource.data.text == ''))
          && request.resource.data.updatedAt == request.time;
      }
      allow create: if signedIn() && userId == request.auth.uid
        && validNotepad() && request.resource.data.revision == 1;
      allow update: if signedIn() && userId == request.auth.uid
        && resource.data.uid == request.auth.uid && !('deleted' in resource.data) && validNotepad()
        && request.resource.data.revision == resource.data.revision + 1;
      match /notes/{noteId} {
        function validNote() {
          return request.resource.data.keys().hasOnly(['uid', 'title', 'text', 'revision', 'folderId', 'archived', 'createdAt', 'updatedAt'])
            && request.resource.data.uid == request.auth.uid
            && request.resource.data.title is string && request.resource.data.title.size() > 0 && request.resource.data.title.size() <= 120
            && request.resource.data.text is string && request.resource.data.text.size() <= 50000
            && request.resource.data.revision is int && request.resource.data.revision >= 0
            && (request.resource.data.folderId == null || (request.resource.data.folderId is string && request.resource.data.folderId.size() <= 128))
            && request.resource.data.archived is bool && request.resource.data.createdAt is timestamp
            && request.resource.data.updatedAt == request.time;
        }
        allow read: if signedIn() && userId == request.auth.uid;
        allow delete: if signedIn() && userId == request.auth.uid;
        allow create: if signedIn() && userId == request.auth.uid && validNote()
          && (noteId != 'legacy' || !exists(/databases/$(database)/documents/notepads/$(userId))
            || !('deleted' in get(/databases/$(database)/documents/notepads/$(userId)).data))
          && request.resource.data.revision == 0 && request.resource.data.createdAt == request.time;
        allow update: if signedIn() && userId == request.auth.uid && resource.data.uid == request.auth.uid && validNote()
          && request.resource.data.createdAt == resource.data.createdAt
          && ((request.resource.data.revision == resource.data.revision && request.resource.data.text == resource.data.text)
            || request.resource.data.revision == resource.data.revision + 1);
      }
      match /folders/{folderId} {
        function validFolder() {
          return request.resource.data.keys().hasOnly(['uid', 'name', 'sortOrder', 'createdAt', 'updatedAt'])
            && request.resource.data.uid == request.auth.uid
            && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 80
            && (!('sortOrder' in request.resource.data) || (request.resource.data.sortOrder is int && request.resource.data.sortOrder >= 0))
            && request.resource.data.createdAt is timestamp && request.resource.data.updatedAt == request.time;
        }
        allow read, delete: if signedIn() && userId == request.auth.uid;
        allow create: if signedIn() && userId == request.auth.uid && validFolder() && request.resource.data.createdAt == request.time;
        allow update: if signedIn() && userId == request.auth.uid && validFolder() && request.resource.data.createdAt == resource.data.createdAt;
      }
    }
```

기존 signedIn() 함수를 사용합니다. 전체 규칙은 firestore.rules에도 반영되어 있습니다.
게시 후 메모 탭에서 다시 연결을 누르세요. 기존 메모는 기존 메모 항목으로 유지됩니다.
폴더를 삭제해도 메모 본문은 보존하며, 삭제한 메모는 휴지통에서 복원할 수 있습니다.
