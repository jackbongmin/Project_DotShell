package com.dotshell.engine.game;

import java.util.List;
import java.util.Map;

/**
 * 스테이지 정의. resources/stages/*.json 에서 읽는다.
 *
 * @param id           스테이지 번호 (예: 1-1)
 * @param title        스테이지 이름
 * @param coreHp       서버 코어 체력
 * @param introSeconds 첫 웨이브 전 준비 시간
 * @param breakSeconds 웨이브 사이 쉬는 시간
 * @param parCommands  별점 기준 명령 수
 * @param intro        시작할 때 데몬이 하는 말
 * @param startCards   처음부터 가진 명령어 카드
 * @param cards        명령어 카드 정의 (이름 → 설명)
 * @param monsters     몬스터 종류 (프로세스 이름 → 정의)
 * @param waves        웨이브 목록
 */
public record StageDefinition(
		String id,
		String title,
		double coreHp,
		double introSeconds,
		double breakSeconds,
		int parCommands,
		List<String> intro,
		List<String> startCards,
		Map<String, Card> cards,
		Map<String, Monster> monsters,
		List<Wave> waves) {

	public record Card(String usage, String desc) {
	}

	/**
	 * 몬스터 종류. 키(프로세스 이름)가 곧 /usr/local/lib/dotshell/monsters/ 아래 실행 파일 이름이다.
	 *
	 * @param label         화면에 보이는 이름
	 * @param args          소환할 때 넘길 인자
	 * @param travelSeconds 동굴에서 코어까지 걸리는 시간
	 * @param dps           코어에 붙었을 때 초당 피해
	 */
	public record Monster(String label, List<String> args, double travelSeconds, double dps) {
		public Monster {
			args = args == null ? List.of() : List.copyOf(args);
		}
	}

	public record Wave(List<Spawn> spawns, String hint, List<String> unlock) {
	}

	public record Spawn(String kind, int count, double intervalSeconds) {
	}
}
