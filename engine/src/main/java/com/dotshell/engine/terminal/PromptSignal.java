package com.dotshell.engine.terminal;

/**
 * 컨테이너의 프롬프트 훅(docker/player/dotshell-hook.sh)이 보낸 "명령 종료" 신호.
 *
 * @param exitCode      직전 명령의 종료 코드
 * @param historyNumber bash 히스토리 번호. 직전 신호와 같으면 빈 줄 Enter
 * @param cwd           명령이 끝난 뒤의 현재 디렉터리
 * @param command       직전에 입력한 명령어 문자열 (연출 선택용)
 */
public record PromptSignal(int exitCode, long historyNumber, String cwd, String command) {
}
