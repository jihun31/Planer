# Planer1 작업 지침

- 사용자에게 보이는 모든 글은 한국어로 쓴다. 답변 본문뿐 아니라 작업 목록, 요약 상자(recap), 질문과 선택 버튼, 선택지 설명, 확인 요청도 포함한다. 코드·명령어·파일 경로·커밋 메시지처럼 원문 그대로여야 하는 것만 예외로 한다.
- 사용자가 명시적으로 지시한 경우에만 GitHub에 push한다. GitHub 커넥터 등을 통한 원격 브랜치·커밋 업로드에도 같은 기준을 적용한다.
- 저장소는 `C:\Users\baek\Projects\Planer`, 설치된 앱은 `C:\Users\baek\AppData\Local\Programs\Planer`다. 설치 폴더 안에는 저장소·작업 파일·백업을 두지 않는다. 자동 업데이트 설치 프로그램이 설치 폴더를 통째로 지우고 다시 설치하기 때문이다(2026-11-20에 설치 폴더 안의 작업 폴더와 지침 파일이 이렇게 지워졌다). 설치본 백업은 저장소의 `.tmp/` 같은 설치 폴더 밖에 둔다.
- GitHub에 새 버전(`vX.Y.Z`)을 배포하는 push를 할 때는 배포 태그와 `package.json`의 `version`(`X.Y.Z`)을 맞춘다. CI(`release.yml`)는 `scripts/check-version.mjs --release-dir`로 태그·`package.json`·`latest.yml`·빌드된 앱 버전이 같은지와 빌드 기록을 검사하고, 다르면 릴리스하지 않는다. 같은 변경사항을 포함한 로컬 설치본도 그 버전이어야 하며, 저장소에서 `npm run check:version`을 실행해 통과해야 완료로 본다(설치본 `resources/app.asar` 버전 = GitHub 최신 릴리스 `latest.yml` 버전, 앱 파일 지문 = 빌드 기록 `dist/build-info.json`).
- 로컬 설치본은 커밋된 소스로만 만든다. 릴리스가 나온 뒤라면 앱의 자동 업데이트(같은 커밋의 CI 빌드)로 받는 것이 가장 안전하다. 직접 바꿀 때는 커밋 후 `npm run app:local -- -c.extraMetadata.version=X.Y.Z`로 빌드하고, Planer를 종료하고 `%LOCALAPPDATA%\planer-updater\pending`에 대기 중인 업데이트 설치가 없는지 확인한 뒤, `release/win-unpacked/resources/app.asar`를 설치 폴더의 `resources/app.asar`로 복사한다. 설치된 app.asar를 직접 열어 고치지 않는다. 그렇게 고치면 `check:version`의 빌드 검사가 실패한다.
- 수정 후에는 `npm run test:affected`로 변경 파일과 관련된 테스트만 실행한다. 직접 테스트를 고르지 않는다. 전체 테스트는 사용자가 요청한 경우나, 스크립트가 "영향 범위를 좁힐 수 없는 파일"을 알렸을 때 사용자에게 확인한 뒤 실행한다. 스크립트가 "자동 테스트가 닿지 않는 파일"로 알린 변경은 앱을 실행해 직접 확인하고 결과를 보고한다.
