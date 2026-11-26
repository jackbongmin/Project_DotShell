# DotShell 프롬프트 훅
#
# 명령이 끝나고 프롬프트가 뜨기 직전마다 아래 형식의 OSC 이스케이프 시퀀스를 출력한다.
# 터미널 화면에는 보이지 않고, 엔진이 PTY 출력에서 잘라내 상태 갱신 신호로 쓴다.
#
#   ESC ] 777 ; dotshell ; <종료코드> ; <히스토리번호> ; <base64(PWD)> ; <base64(명령어)> BEL
#
# 히스토리 번호가 직전과 같으면 빈 줄에서 Enter만 친 것이다.

if [ -n "${__DOTSHELL_HOOK_LOADED:-}" ]; then
  return 0 2>/dev/null || true
fi
__DOTSHELL_HOOK_LOADED=1

HISTCONTROL=
HISTTIMEFORMAT=

__dotshell_prompt_hook() {
  local ec=$?
  local line num cmd
  line=$(history 1)
  num=$(printf '%s' "$line" | sed -E 's/^ *([0-9]+).*/\1/')
  cmd=$(printf '%s' "$line" | sed -E 's/^ *[0-9]+\*? *//')
  printf '\033]777;dotshell;%s;%s;%s;%s\007' \
    "$ec" "${num:-0}" \
    "$(printf '%s' "$PWD" | base64 -w0)" \
    "$(printf '%s' "$cmd" | base64 -w0)"
}

PROMPT_COMMAND=__dotshell_prompt_hook
