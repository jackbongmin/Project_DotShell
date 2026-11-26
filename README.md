# DotShell

진짜 우분투 터미널로 주문을 외워, 서버 왕국에 쳐들어오는 버그를 물리치는 도트 RPG.

현재 단계: **마을 + 1-1 버그 습격.** 게임 창 안의 터미널이 Docker 컨테이너의 진짜 bash에 연결된다. 홈 디렉터리가 **마을**이고, 명령어를 치면 주인공이 직접 걸어가서 행동한다. `cd rift`로 균열에 들어가면 컨테이너 안의 **진짜 프로세스가 몬스터**로 나오는 전투가 시작된다.

기획서: [docs/DotShell_기획서.md](docs/DotShell_기획서.md)

## 플레이

`start.bat`을 더블클릭하고, 게임 창 아래 터미널에 명령어를 친다.

**마을 (홈 디렉터리 `~`)** — 디렉터리 = 장소. 광장의 집이 하위 디렉터리, 바닥의 두루마리가 파일이다.

| 명령어 (진짜 리눅스 명령) | 주인공이 하는 일 |
|---|---|
| `ls`, `ls -a` | 횃불을 들어 장소를 밝힌다 / 숨은 보물까지 |
| `cd 이름`, `cd ..` | 그 집(문)까지 걸어가 들어간다 / 출구로 걸어 나간다 |
| `cat 파일` | 두루마리까지 걸어가 읽는다 (실제 내용이 양피지로 뜬다) |
| `touch`, `mkdir` | 물건을 놓는다 / 집을 짓는다 |
| `mv`, `cp`, `rm` | 들고 옮긴다 / 복제한다 / 검으로 부순다 |
| `pwd` | 머리 위에 현재 경로 표지판 |

처음 성공한 명령은 주문서(F1)에 새겨진다. 퀘스트: 게시판 읽기(`cat welcome.txt`) → 도서관(`cd library`) → 균열(`cd rift`).

**전투 (`~/rift` 안)** — 들어가면 스테이지가 시작되고, `cd ..`로 나오면 끝난다.

| 하고 싶은 것 | 명령어 |
|---|---|
| 몬스터 정찰 (PID 알아내기) | `ps aux` |
| 하나 처치 | `kill <PID>` |
| 이름으로 한꺼번에 처치 | `pkill bug` |
| 부모-자식 관계 보기 | `pstree -p`, `ps -ef --forest` |

- **F1** 또는 오른쪽 위 버튼: 명령어 주문서(배운 명령 카드). 열어 둔 채로 계속 입력할 수 있다.
- 몬스터 머리 위 PID는 `ps`로 정찰해야 보인다. 처치하면 주인공이 단검(여왕은 대검)을 던진다.

## 구조

```
DotShell (Electron 창)
 ├─ client/   화면: Phaser(마을 village.js · 전투 battle.js, 전환 boot.js) + xterm.js(터미널) + 패널
 │             │ WebSocket  ws://127.0.0.1:8730/ws/terminal
 ├─ engine/   Spring Boot: 컨테이너 관리, 터미널 중계, 스테이지 러너(웨이브·HP·판정)
 │             │ docker-java
 └─ docker/player/   플레이어 컨테이너 이미지
       ├─ village/        홈 디렉터리 내용 (게시판, library 주문서, rift)
       ├─ rift            PID 1 아래의 균열(root). 엔진의 요청으로 몬스터를 자식 프로세스로 소환
       ├─ monsters/       bug(sleep 복사본), bug-queen(새끼를 낳는 bash 스크립트)
       ├─ watchtower      0.5초마다 프로세스 목록을 엔진에 스트리밍
       └─ dotshell-hook.sh  명령 종료 신호(OSC 777)
```

| 폴더 | 기술 |
|---|---|
| `engine/` | Java 21, Spring Boot 4.2, Spring WebSocket, docker-java 3.7 |
| `client/` | Electron 45, Phaser 4.2, xterm.js 6, Galmuri 글꼴 |
| `docker/player/` | Ubuntu 24.04, 사용자 `hero` |

### 명령 종료를 아는 방법

컨테이너 bash의 `PROMPT_COMMAND` 훅이 프롬프트 직전마다 보이지 않는 OSC 시퀀스를 출력한다.

```
ESC ] 777 ; dotshell ; <종료코드> ; <히스토리번호> ; base64(PWD) ; base64(명령어) BEL
```

엔진의 `PromptSignalParser`가 이 신호를 터미널 출력에서 잘라내고, 디렉터리 상태를 조회해 `state` 메시지로 보낸다. 명령어를 해석하지 않고 **결과 상태를 비교**하므로 어떤 명령이든 그대로 반영된다.

### 몬스터 = 진짜 프로세스

- 엔진이 `/run/dotshell/rift`(FIFO)에 몬스터 이름을 쓰면, root로 도는 균열이 `hero` 소유로 몬스터를 띄운다. 그래서 `pstree -p`에 `docker-init ─ rift ─ bug-queen ─ bug`로 보이고, 플레이어는 sudo 없이 몬스터를 kill 할 수 있지만 균열 자체는 못 없앤다.
- 감시탑이 보내는 프로세스 목록에서 몬스터가 사라지면 처치로 판정한다. 진행도·피해·승패·별점은 엔진의 `StageRunner`가 계산한다.
- 스테이지는 [engine/src/main/resources/stages/1-1.json](engine/src/main/resources/stages/1-1.json)으로 정의한다(몬스터, 웨이브, 힌트, 해금 카드).

### 웹소켓 메시지

| 방향 | type | 내용 |
|---|---|---|
| 클라이언트 → 엔진 | `input`, `resize`, `restart` | 키 입력, 창 크기, 스테이지 다시 시작 |
| 엔진 → 클라이언트 | (바이너리) | 터미널 출력 (신호 제거됨) |
| 엔진 → 클라이언트 | `status`, `error` | 준비 상태, 오류 |
| 엔진 → 클라이언트 | `state` | 명령 하나 끝남: 명령어, 종료 코드, 현재 방, 방 안 물건 |
| 엔진 → 클라이언트 | `stage`, `world`, `announce`, `result` | 스테이지 정보, 0.5초마다 전장, 데몬 대사·카드 해금, 승패·별점 |

## 실행

필요한 것: JDK 21, Node.js, Docker Desktop

**`start.bat`을 더블클릭**하면 끝이다. 스크립트([start.ps1](start.ps1))가 다음을 알아서 한다.

- JDK 21을 찾아 `JAVA_HOME`으로 지정 (IntelliJ가 받은 `~/.jdks`도 찾음)
- Docker Desktop이 꺼져 있으면 켜고 기다림
- 엔진을 "DotShell 엔진" 창에서 실행 (이미 떠 있으면 재사용). 플레이어 이미지가 없으면 처음에 자동으로 빌드한다
- 클라이언트 패키지가 없으면 설치한 뒤 게임 창 실행

게임 창을 닫아도 엔진 창은 남아 있으므로, 다시 `start.bat`을 실행하면 바로 연결된다. 엔진 코드를 바꿨다면 엔진 창을 닫고 다시 실행한다.

### 수동 실행

1. 엔진: `cd engine; .\gradlew.bat bootRun`
2. 게임 창: `cd client; npm install; npm start`

플레이어 컨테이너는 접속마다 새로 만들어지고, 창을 닫거나 엔진을 다시 켜면 삭제된다. 외부 네트워크 차단, 메모리 512MB, CPU 1개, 프로세스 256개로 제한된다. `docker/player`를 고치면 [application.properties](engine/src/main/resources/application.properties)의 이미지 태그를 올린다.

### 테스트

```powershell
cd engine; .\gradlew.bat test
```

## 아트

- 기준 에셋: [Kenney](https://kenney.nl) Monochrome RPG / Pirates (CC0) — `assets/`
- 환경은 원본 4색 보라 그대로, 주인공·몬스터·아이템은 배경을 따고 색 램프로 채색해 잘 보이게 한다.
- Kenney에 없는 것(버그, 여왕, 서버 코어, 두루마리, 균열 문)은 같은 팔레트 규칙으로 코드로 그린다.
- 스프라이트 다시 만들기: `cd client; node tools/sprites.mjs` → `client/src/renderer/assets/sprites/`. 생성된 PNG를 Pixelorama·Aseprite로 직접 고쳐도 된다.
- 글꼴: [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1)

## 문제 해결

**Gradle이 `Unable to establish loopback connection`으로 실패할 때**

일부 Windows 환경에서는 `%TEMP%` 아래에 Java의 Unix 도메인 소켓을 만들지 못한다. `start.bat`은 자동으로 피해 가고, 직접 실행할 때는:

```powershell
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$PWD\.tmp"; New-Item -ItemType Directory -Force .tmp
```

**`JAVA_HOME is not set`**

IntelliJ가 받은 JDK를 쓰는 경우 예: `$env:JAVA_HOME = "$env:USERPROFILE\.jdks\ms-21.0.12.1"`

## 다음 단계

- 던전 탐험 퀘스트(열쇠를 vault 로 옮기기 등), 스테이지 선택
- 마을 확장: 상점(apt), 권한 잠긴 집(chmod)
- 진행도 저장: PostgreSQL (Docker 컨테이너)
- exe 배포: Electron 빌드 + jpackage로 엔진 동봉
