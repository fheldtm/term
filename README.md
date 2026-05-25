# SSH Terminal Composer

Tauri + React 기반 SSH 터미널 작업대입니다. 좌측에는 원격 파일 탐색기, 우측에는 `xterm` 터미널, 하단에는 이미지와 파일을 본문 위치에 토큰으로 삽입하는 composer가 있습니다.

## 주요 기능

- Tauri native command 기반 SSH PTY 터미널 연결
- Tauri native command 기반 SFTP 원격 파일 탐색
- 파일 선택, 드래그앤드롭, 클립보드 붙여넣기 첨부
- 이미지 Preview와 일반 파일 tile 표시
- 본문 커서 위치에 `[_image1]`, `[_file1]` 토큰 삽입
- 제출 시 첨부를 서버의 `~/.terminal-composer/uploads/YYYY-MM-DD/session-id/` 경로로 업로드
- 최종 payload를 터미널 입력 스트림으로 전송
- 전체 UI D2Coding 폰트 적용

## 실행

```bash
npm install
npm run dev
```

`npm run dev`는 Tauri 데스크탑 앱을 띄우고, 내부에서 Vite dev server를 `0.0.0.0:5174`로 실행합니다.

## Build

```bash
npm run tauri:build
npm run tauri:windows:build
npm run tauri:android:init
npm run tauri:android:build
```

- Linux 산출물: `src-tauri/target/release/bundle/`
- Windows 산출물: `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/`
- Android APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/`

Android 빌드는 `ANDROID_HOME` 또는 `ANDROID_SDK_ROOT`가 Android SDK를 가리켜야 합니다. `scripts/tauri-android-build.mjs`가 설치된 NDK를 찾아 OpenSSL/SSH 크로스 컴파일에 필요한 `llvm-ranlib` 환경변수를 설정합니다.

## GitHub Actions

`.github/workflows/build.yml`는 `main` push 또는 수동 실행에서 Windows installer와 Android arm64 APK를 빌드해 Actions artifact로 올립니다. `v*` 태그를 push하면 같은 산출물을 GitHub Release에 첨부합니다.

Android release APK signing은 선택 사항입니다. GitHub repository secrets에 아래 값을 넣으면 CI가 signed APK도 생성합니다.

- `ANDROID_KEYSTORE_B64`: `.jks` 파일을 base64로 인코딩한 값
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## 사용 흐름

1. 앱을 열면 데모 세션이 자동으로 시작됩니다.
2. 실제 서버에 붙으려면 `SSH 설정`에서 host, port, user, password 또는 private key를 입력합니다.
3. 좌측 파일 탐색기에서 원격 경로를 확인합니다.
4. composer에 텍스트를 입력합니다.
5. 파일 버튼, 드래그앤드롭, 붙여넣기로 파일을 추가합니다.
6. 현재 커서 위치에 `[_imageN]` 또는 `[_fileN]` 토큰이 삽입됩니다.
7. 제출 버튼을 누르면 첨부 업로드 후 터미널로 payload가 전송됩니다.

## Payload 예시

```text
이 서버의 현재 화면 [_image1] 과 로그 [_file1] 를 보고 문제를 찾아줘.

User uploaded files:
- [_image1] screen.png (593.7 KB, image/png): /home/user/.terminal-composer/uploads/2026-05-25/abc123/screen.png
- [_file1] server.log (18.4 KB, text/plain): /home/user/.terminal-composer/uploads/2026-05-25/abc123/server.log
```

## 기술 스택

- React + Vite + TypeScript
- `lucide-react`
- `@xterm/xterm`
- Tauri v2
- Rust `ssh2` for native SSH/SFTP
- D2Coding font package

## Web Fallback

기존 Node.js + Express backend는 브라우저 단독 실행 실험용 fallback으로 남겨두었습니다. 실제 데스크탑/모바일 앱 경로는 Tauri native backend를 사용합니다.
