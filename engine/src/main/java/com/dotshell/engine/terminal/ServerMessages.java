package com.dotshell.engine.terminal;

import java.util.List;

import com.dotshell.engine.container.DirectoryEntry;

/**
 * 엔진 → 클라이언트 JSON 메시지 (웹소켓 텍스트 프레임).
 * 터미널 출력 자체는 바이너리 프레임으로 따로 보낸다.
 */
final class ServerMessages {

	private ServerMessages() {
	}

	/** 준비 단계 알림. phase: preparing, building, ready, exited */
	record Status(String type, String phase, String message) {
		Status(String phase, String message) {
			this("status", phase, message);
		}
	}

	record Error(String type, String message) {
		Error(String message) {
			this("error", message);
		}
	}

	/** 명령 하나가 끝난 뒤의 상태. 도트 화면은 이걸로 다시 그린다. */
	record State(
			String type,
			int exitCode,
			String command,
			boolean newCommand,
			String cwd,
			List<DirectoryEntry> entries) {
		State(PromptSignal signal, boolean newCommand, List<DirectoryEntry> entries) {
			this("state", signal.exitCode(), signal.command(), newCommand, signal.cwd(), entries);
		}
	}
}
