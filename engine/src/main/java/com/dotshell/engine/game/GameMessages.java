package com.dotshell.engine.game;

import java.util.List;
import java.util.Map;

/** 스테이지 러너 → 클라이언트 JSON 메시지. */
public final class GameMessages {

	private GameMessages() {
	}

	/** 스테이지 시작 시 한 번. 클라이언트가 HUD와 카드 패널을 만든다. */
	public record Stage(
			String type,
			String id,
			String title,
			int waveTotal,
			double coreHp,
			Map<String, StageDefinition.Card> cards,
			List<String> startCards,
			Map<String, String> monsterLabels) {
	}

	/** 0.5초마다 보내는 전장 상태. */
	public record World(
			String type,
			String phase,
			boolean paused,
			int wave,
			int waveTotal,
			double hp,
			double maxHp,
			long phaseRemainingMs,
			List<MonsterView> monsters,
			int kills,
			int commands,
			long elapsedMs) {
	}

	/**
	 * @param progress 0(동굴) ~ 1(코어 도착)
	 * @param speed    초당 progress 증가량. 클라이언트가 틱 사이를 부드럽게 보간한다.
	 */
	public record MonsterView(int pid, int ppid, String kind, double progress, double speed, boolean attacking) {
	}

	/** 데몬의 대사. unlock은 새로 해금된 명령어 카드. */
	public record Announce(String type, String speaker, String text, List<String> unlock) {
		public Announce(String text, List<String> unlock) {
			this("announce", "daemon", text, unlock);
		}
	}

	/** 스테이지 결과. */
	public record Result(
			String type,
			String outcome,
			long elapsedMs,
			int commands,
			int kills,
			double hp,
			double maxHp,
			List<Star> stars) {
	}

	public record Star(String label, boolean earned) {
	}
}
