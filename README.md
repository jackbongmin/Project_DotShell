# DotShell

진짜 우분투 터미널에 명령어를 치면, 그 결과가 도트 세계에서 그대로 벌어지는 학습 게임.

현재 단계: **프로토타입** — 게임 창 안의 터미널이 Docker 컨테이너의 진짜 bash에 연결되고, 명령이 끝날 때마다 현재 방(디렉터리)을 도트로 다시 그린다.

## 구조

```
DotShell (Electron 창)
 ├─ client/   화면: xterm.js(터미널) + Canvas(도트 세계)
 │             │ WebSocket  ws://127.0.0.1:8730/ws/terminal
 ├─ engine/   Spring Boot: 컨테이너 관리, 터미널 중계, 상태 스냅샷
 │             │ docker-java (exec tty)
 └─ docker/player/   플레이어 컨테이너 이미지 (ubuntu 24.04 + bash 훅)
```

| 폴더 | 기술 |
|---|---|
| `engine/` | Java 21, Spring Boot 4.2, Spring WebSocket, docker-java 3.7 |
| `client/` | Electron 45, xterm.js 6 |
| `docker/player/` | Ubuntu 24.04, 사용자 `hero` |

### 명령 종료를 아는 방법

컨테이너의 bash에 `PROMPT_COMMAND` 훅([docker/player/dotshell-hook.sh](docker/player/dotshell-hook.sh))을 넣어, 프롬프트가 뜨기 직전마다 화면에 보이지 않는 OSC 이스케이프 시퀀스를 출력한다.

```
ESC ] 777 ; dotshell ; <종료코드> ; <히스토리번호> ; base64(PWD) ; base64(명령어) BEL
```

엔진의 `PromptSignalParser`가 터미널 출력에서 이 신호를 잘라내고, 그 시점에 디렉터리 상태를 조회해 클라이언트에 `state` 메시지로 보낸다. 명령어 문자열을 해석하지 않고 **상태를 비교**하므로 `mkdir -p a/b/c`, `mv *.txt docs/` 같은 어떤 명령이든 결과가 그대로 반영된다.

### 웹소켓 메시지

| 방향 | 형식 | 내용 |
|---|---|---|
| 클라이언트 → 엔진 | JSON | `{"type":"input","data":"ls\r"}`, `{"type":"resize","cols":120,"rows":30}` |
| 엔진 → 클라이언트 | 바이너리 | 터미널 출력 (신호 제거됨) |
| 엔진 → 클라이언트 | JSON | `status`(preparing/building/ready/exited), `error`, `state`(exitCode, command, newCommand, cwd, entries) |

## 실행

필요한 것: JDK 21, Node.js, Docker Desktop (실행 중이어야 함)

1. 엔진 실행 (처음 실행이면 플레이어 이미지를 자동으로 빌드한다)

   ```powershell
   cd engine; .\gradlew.bat bootRun
   ```

2. 다른 터미널에서 게임 창 실행

   ```powershell
   cd client; npm install; npm start
   ```

이미지를 미리 만들어 두려면:

```powershell
docker build -t dotshell/player:proto docker/player
```

플레이어 컨테이너는 접속마다 새로 만들어지고, 창을 닫거나 엔진을 다시 켜면 삭제된다. 외부 네트워크는 막혀 있고(`--network none`), 메모리 512MB, CPU 1개, 프로세스 256개로 제한된다.

### 테스트

```powershell
cd engine; .\gradlew.bat test
```

## 문제 해결

**Gradle이 `Unable to establish loopback connection`으로 실패할 때**

일부 Windows 환경에서는 `%TEMP%` 아래에 Java의 Unix 도메인 소켓을 만들지 못한다. 소켓 임시 폴더를 다른 곳으로 지정하면 해결된다.

```powershell
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$PWD\.tmp"; New-Item -ItemType Directory -Force .tmp
```

**`JAVA_HOME is not set`**

IntelliJ가 받은 JDK를 쓰는 경우 예: `$env:JAVA_HOME = "$env:USERPROFILE\.jdks\ms-21.0.12.1"`

## 다음 단계

- MVP: cd 던전 스테이지 3개 (스테이지 YAML, 퀘스트 판정, 힌트 NPC, Phaser + PNG 스프라이트)
- 진행도 저장: PostgreSQL (Docker 컨테이너)
- exe 배포: Electron 빌드 + jpackage로 엔진 동봉

기획서: [docs/DotShell_기획서.md](docs/DotShell_기획서.md)
