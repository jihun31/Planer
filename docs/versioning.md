# 앱 버전 규칙

AGENTS.md에서 옮긴 세부 내용이다. 버전·릴리스 스크립트를 고치거나 버전 검사가 실패했을 때 읽는다.

- 앱 버전은 `scripts/app-version.mjs` 한 곳에서 정한다: `package.json` `version`의 앞 두 자리(`X.Y.0` 형식으로 둔다) + 커밋 수(`git rev-list --count`).
- CI(`release.yml`)와 `install:local`이 같은 규칙을 쓰므로 같은 커밋이면 로컬 설치본과 릴리스 버전이 같다.
- `package.json`의 마지막 자리는 손으로 올리지 않는다. main 기록을 다시 써서 커밋 수가 줄면 버전이 내려가므로 그때는 앞 두 자리를 올린다.
- CI는 `scripts/check-version.mjs --release-dir`로 태그·`package.json`·`latest.yml`·빌드된 앱 버전이 같은지와 빌드 기록을 검사하고, 다르면 릴리스하지 않는다.
- 로컬 설치본은 저장소에서 `npm run check:version`을 실행해 통과해야 완료로 본다. 검사 내용: 설치본 `resources/app.asar` 버전 = 그 설치본을 빌드한 커밋의 버전, 앱 파일 지문 = 빌드 기록 `dist/build-info.json`.
