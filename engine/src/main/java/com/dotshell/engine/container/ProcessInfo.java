package com.dotshell.engine.container;

/**
 * 컨테이너 안 프로세스 하나 (감시탑 출력 한 줄).
 *
 * @param pid  프로세스 ID
 * @param ppid 부모 프로세스 ID
 * @param stat 상태 (R, S, Z ...)
 * @param comm 프로세스 이름
 */
public record ProcessInfo(int pid, int ppid, String stat, String comm) {

	public boolean zombie() {
		return stat.startsWith("Z");
	}

	static ProcessInfo parse(String line) {
		String[] parts = line.trim().split("\\s+", 4);
		if (parts.length < 4) {
			return null;
		}
		try {
			return new ProcessInfo(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), parts[2], parts[3]);
		} catch (NumberFormatException e) {
			return null;
		}
	}
}
