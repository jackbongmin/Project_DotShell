# DotShell 플레이어 컨테이너 (프로토타입)
# 플레이어가 게임 안 터미널에 치는 명령어는 모두 이 컨테이너의 진짜 bash에서 실행된다.
FROM ubuntu:24.04

# 이미지 내용이 바뀌면 이 값을 올리고 engine의 dotshell.player.image 태그도 맞춘다.
LABEL dotshell.image-version="4"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash-completion ca-certificates git less nano procps psmisc tree vim-tiny \
 && rm -rf /var/lib/apt/lists/*

# 몬스터 = 이름 붙은 진짜 실행 파일. ps 에 그 이름으로 보이고 kill / pkill 로 잡힌다.
#  - bug       : sleep 을 복사한 것 (CPU를 쓰지 않음)
#  - bug-queen : 새끼 bug 를 계속 낳는 부모 프로세스
COPY monsters/ /usr/local/lib/dotshell/monsters/
COPY watchtower rift /usr/local/lib/dotshell/
RUN cp /bin/sleep /usr/local/lib/dotshell/monsters/bug \
 && chmod 755 /usr/local/lib/dotshell/monsters/* /usr/local/lib/dotshell/watchtower /usr/local/lib/dotshell/rift

# 명령 종료 신호 훅: 프롬프트가 뜨기 직전마다 엔진에 신호를 보낸다.
COPY dotshell-hook.sh /etc/dotshell/hook.sh

# skel의 .bashrc 맨 끝에서 훅을 불러야 HISTCONTROL 등 기본 설정을 덮어쓸 수 있다.
RUN echo '. /etc/dotshell/hook.sh' >> /etc/skel/.bashrc \
 && echo '. /etc/dotshell/hook.sh' >> /etc/bash.bashrc \
 && (userdel -r ubuntu 2>/dev/null || true) \
 && useradd -m -s /bin/bash hero

# 마을: 홈 디렉터리 = 마을 광장, 하위 디렉터리 = 건물
#  - library : 명령어 주문서(실제 사용법)를 읽는 도서관
#  - dungeon : 탐험용 던전
#  - rift    : 균열. cd rift 로 들어가면 전투(스테이지)가 시작된다
COPY village/ /home/hero/
RUN mkdir -p /home/hero/dungeon/vault /home/hero/dungeon/hall \
 && echo '금고 열쇠다. vault 안에 넣어야 문이 열린다.' > /home/hero/dungeon/key.txt \
 && echo '반짝이는 숨겨진 보물' > /home/hero/dungeon/.secret \
 && echo '광장 분수 밑에 묻어 둔 지도. 던전 금고(vault)를 찾아라.' > /home/hero/.old_map \
 && find /home/hero -type f -exec chmod 644 {} + \
 && chown -R hero:hero /home/hero

WORKDIR /home/hero

# 첫 프로세스는 root 소유의 균열. 엔진의 소환 요청을 받아 몬스터를 낳는다.
# 플레이어의 bash는 엔진이 exec로 hero 사용자로 붙인다.
CMD ["/usr/local/lib/dotshell/rift"]
