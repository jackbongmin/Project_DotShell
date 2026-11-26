# DotShell 플레이어 컨테이너 (프로토타입)
# 플레이어가 게임 안 터미널에 치는 명령어는 모두 이 컨테이너의 진짜 bash에서 실행된다.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash-completion ca-certificates git less nano tree vim-tiny \
 && rm -rf /var/lib/apt/lists/*

# 명령 종료 신호 훅: 프롬프트가 뜨기 직전마다 엔진에 신호를 보낸다.
COPY dotshell-hook.sh /etc/dotshell/hook.sh

# skel의 .bashrc 맨 끝에서 훅을 불러야 HISTCONTROL 등 기본 설정을 덮어쓸 수 있다.
RUN echo '. /etc/dotshell/hook.sh' >> /etc/skel/.bashrc \
 && echo '. /etc/dotshell/hook.sh' >> /etc/bash.bashrc \
 && (userdel -r ubuntu 2>/dev/null || true) \
 && useradd -m -s /bin/bash hero

# 프로토타입용 작은 던전
RUN mkdir -p /home/hero/dungeon/vault /home/hero/dungeon/hall \
 && echo '금고 열쇠다. vault 안에 넣어야 문이 열린다.' > /home/hero/dungeon/key.txt \
 && echo '견습 관리자여, 서버 왕국에 온 것을 환영한다.' > /home/hero/welcome.txt \
 && echo '반짝이는 숨겨진 보물' > /home/hero/dungeon/.secret \
 && chown -R hero:hero /home/hero

USER hero
WORKDIR /home/hero

# 엔진이 exec로 bash를 붙일 때까지 컨테이너를 살려 둔다.
CMD ["sleep", "infinity"]
