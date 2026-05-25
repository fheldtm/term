# SSH Terminal Composer

React + Node.js 기반 SSH 터미널 작업대입니다. 좌측에는 원격 파일 탐색기, 우측에는 `xterm` 터미널, 하단에는 이미지와 파일을 본문 위치에 토큰으로 삽입하는 composer가 있습니다.

## 주요 기능

- Node.js `ssh2` 기반 SSH PTY 터미널 연결
- Node.js `ssh2` SFTP 기반 원격 파일 탐색
- 파일 선택, 드래그앤드롭, 클립보드 붙여넣기 첨부
- 이미지 Preview와 일반 파일 tile 표시
- 본문 커서 위치에 `[_image1]`, `[_file1]` 토큰 삽입
- 제출 시 첨부를 SSH 서버의 `~/.terminal-composer/uploads/YYYY-MM-DD/session-id/` 경로로 업로드
- 최종 payload를 터미널 입력 스트림으로 전송
- 전체 UI D2Coding 폰트 적용

## 개발 실행

```bash
npm install
npm run dev
```

`npm run dev`는 Node 백엔드와 Vite 프론트엔드를 함께 띄웁니다.

- 프론트엔드: `http://localhost:5174`
- 백엔드: `http://localhost:8787`
- Vite는 `/api`와 `/ws`를 Node 백엔드로 프록시합니다.

각 프로세스를 따로 실행하려면:

```bash
npm run dev:server
npm run dev:client
```

## 프로덕션 실행

```bash
npm run build
HOST=0.0.0.0 PORT=8787 npm run start
```

프로덕션에서는 Node 서버가 `dist` 정적 파일, `/api`, `/ws/terminal/:sessionId`를 모두 처리합니다.

## 사용 흐름

1. 웹을 열고 `SSH 설정`에서 host, port, user, password 또는 private key를 입력합니다.
2. 연결 후 좌측 파일 탐색기에서 원격 경로를 확인합니다.
3. composer에 텍스트를 입력합니다.
4. 파일 버튼, 드래그앤드롭, 붙여넣기로 파일을 추가합니다.
5. 현재 커서 위치에 `[_imageN]` 또는 `[_fileN]` 토큰이 삽입됩니다.
6. 제출 버튼을 누르면 첨부가 SFTP로 원격 서버에 업로드됩니다.
7. 업로드된 원격 경로가 포함된 payload가 터미널 입력 스트림으로 전송됩니다.

## Payload 예시

```text
이 서버의 현재 화면 [_image1] 과 로그 [_file1] 를 보고 문제를 찾아줘.

User uploaded files:
- [_image1] screen.png (593.7 KB, image/png): /home/user/.terminal-composer/uploads/2026-05-25/abc123/screen.png
- [_file1] server.log (18.4 KB, text/plain): /home/user/.terminal-composer/uploads/2026-05-25/abc123/server.log
```

## 기술 스택

- React + Vite + TypeScript
- Node.js + Express
- `ssh2` for SSH/SFTP
- `ws` for browser terminal transport
- `multer` for browser file uploads
- `@xterm/xterm`
- `lucide-react`
- D2Coding font package
