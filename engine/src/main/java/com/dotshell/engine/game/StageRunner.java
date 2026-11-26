package com.dotshell.engine.game;

import java.io.Closeable;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.dotshell.engine.container.PlayerContainerService;
import com.dotshell.engine.container.ProcessInfo;

/**
 * 스테이지 한 판을 진행한다: 웨이브 소환, 몬스터 진행도, 코어 HP, 승패와 별점.
 *
 * 몬스터는 컨테이너의 진짜 프로세스다. 러너는 감시탑이 보내는 프로세스 목록으로
 * 어떤 몬스터가 살아 있는지 알고, 진행도와 피해는 처음 본 시각을 기준으로 직접 계산한다.
 *
 * 모든 상태는 ticker 스레드 하나에서만 바꾼다. 다른 스레드의 이벤트는 ticker.execute로 넘긴다.
 */
public class StageRunner {

	private static final Logger log = LoggerFactory.getLogger(StageRunner.class);
	private static final long TICK_MS = 250;
	private static final long WORLD_EVERY_MS = 500;
	private static final long CLEAR_GRACE_MS = 1500;

	enum Phase { INTRO, WAVE, BREAK, VICTORY, DEFEAT }

	private record PendingSpawn(String kind, long dueAt) {
	}

	private static final class Tracked {
		final String kind;
		final int ppid;
		final long firstSeen;
		final double startProgress;

		Tracked(String kind, int ppid, long firstSeen, double startProgress) {
			this.kind = kind;
			this.ppid = ppid;
			this.firstSeen = firstSeen;
			this.startProgress = startProgress;
		}
	}

	private final StageDefinition stage;
	private final String containerId;
	private final PlayerContainerService containers;
	private final Consumer<Object> send;
	private final ScheduledExecutorService ticker =
			Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().name("stage-", 0).factory());

	private Closeable watcher;
	private Phase phase;
	private long phaseStartedAt;
	private long stageStartedAt;
	private long lastTickAt;
	private long lastWorldAt;
	private long lastSpawnAt;
	private int waveIndex;
	private double hp;
	private int kills;
	private int commands;
	private long ignoreNewUntil;
	private final Deque<PendingSpawn> spawnQueue = new ArrayDeque<>();
	private final Map<Integer, Tracked> monsters = new LinkedHashMap<>();

	StageRunner(StageDefinition stage, String containerId, PlayerContainerService containers, Consumer<Object> send) {
		this.stage = stage;
		this.containerId = containerId;
		this.containers = containers;
		this.send = send;
	}

	void start() {
		watcher = containers.watchProcesses(containerId, list -> ticker.execute(() -> onProcesses(list)));
		ticker.execute(this::reset);
		ticker.scheduleAtFixedRate(this::safeTick, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS);
	}

	/** 플레이어가 명령을 하나 마쳤다 (프롬프트 신호). */
	public void onCommand(String command) {
		ticker.execute(() -> {
			if (phase == Phase.INTRO || phase == Phase.WAVE || phase == Phase.BREAK) {
				commands++;
			}
			sendWorld(System.currentTimeMillis()); // kill 결과가 바로 보이도록
		});
	}

	public void restart() {
		ticker.execute(() -> {
			containers.killAllMonsters(containerId);
			reset();
			ignoreNewUntil = System.currentTimeMillis() + 1200;
		});
	}

	public void stop() {
		ticker.shutdownNow();
		if (watcher != null) {
			try {
				watcher.close();
			} catch (IOException e) {
				// 무시
			}
		}
	}

	// ── ticker 스레드 ─────────────────────────────────────────────────────

	private void reset() {
		long now = System.currentTimeMillis();
		phase = Phase.INTRO;
		phaseStartedAt = now;
		stageStartedAt = now;
		lastTickAt = now;
		waveIndex = -1;
		hp = stage.coreHp();
		kills = 0;
		commands = 0;
		spawnQueue.clear();
		monsters.clear();

		Map<String, String> labels = new HashMap<>();
		stage.monsters().forEach((kind, m) -> labels.put(kind, m.label()));
		send.accept(new GameMessages.Stage("stage", stage.id(), stage.title(), stage.waves().size(),
				stage.coreHp(), stage.cards(), stage.startCards(), labels));
		for (String line : stage.intro()) {
			send.accept(new GameMessages.Announce(line, List.of()));
		}
		sendWorld(now);
	}

	private void safeTick() {
		try {
			tick();
		} catch (RuntimeException e) {
			log.warn("스테이지 틱 오류: {}", e.toString());
		}
	}

	private void tick() {
		long now = System.currentTimeMillis();
		double dt = (now - lastTickAt) / 1000.0;
		lastTickAt = now;

		switch (phase) {
			case INTRO -> {
				if (now - phaseStartedAt >= stage.introSeconds() * 1000) {
					startWave(0, now);
				}
			}
			case WAVE -> {
				while (!spawnQueue.isEmpty() && spawnQueue.peekFirst().dueAt() <= now) {
					spawn(spawnQueue.pollFirst().kind());
					lastSpawnAt = now;
				}
				applyDamage(now, dt);
				if (hp <= 0) {
					finish(false, now);
				} else if (spawnQueue.isEmpty() && monsters.isEmpty() && now - lastSpawnAt > CLEAR_GRACE_MS) {
					if (waveIndex + 1 >= stage.waves().size()) {
						finish(true, now);
					} else {
						phase = Phase.BREAK;
						phaseStartedAt = now;
						send.accept(new GameMessages.Announce("웨이브 클리어! 잠깐 숨 돌리자.", List.of()));
					}
				}
			}
			case BREAK -> {
				applyDamage(now, dt); // 쉬는 동안 몰래 소환된 것까지 처리
				if (now - phaseStartedAt >= stage.breakSeconds() * 1000) {
					startWave(waveIndex + 1, now);
				}
			}
			case VICTORY, DEFEAT -> {
				// 결과 화면. restart를 기다린다.
			}
		}

		if (now - lastWorldAt >= WORLD_EVERY_MS) {
			sendWorld(now);
		}
	}

	private void startWave(int index, long now) {
		waveIndex = index;
		phase = Phase.WAVE;
		phaseStartedAt = now;
		lastSpawnAt = now;
		StageDefinition.Wave wave = stage.waves().get(index);
		long at = now + 1500; // 경고 후 잠시 뒤 등장
		for (StageDefinition.Spawn s : wave.spawns()) {
			for (int i = 0; i < s.count(); i++) {
				spawnQueue.addLast(new PendingSpawn(s.kind(), at));
				at += (long) (s.intervalSeconds() * 1000);
			}
		}
		send.accept(new GameMessages.Announce(wave.hint(), wave.unlock() == null ? List.of() : wave.unlock()));
		log.info("스테이지 {} 웨이브 {} 시작", stage.id(), index + 1);
	}

	private void spawn(String kind) {
		StageDefinition.Monster def = stage.monsters().get(kind);
		try {
			containers.summon(containerId, kind, def.args());
		} catch (RuntimeException e) {
			log.warn("몬스터 {} 소환 실패: {}", kind, e.getMessage());
		}
	}

	private void onProcesses(List<ProcessInfo> processes) {
		if (phase == null) {
			return;
		}
		long now = System.currentTimeMillis();
		Map<Integer, ProcessInfo> alive = new HashMap<>();
		for (ProcessInfo p : processes) {
			if (stage.monsters().containsKey(p.comm()) && !p.zombie()) {
				alive.put(p.pid(), p);
			}
		}
		// 사라진 몬스터 = 처치
		int before = monsters.size();
		monsters.keySet().removeIf(pid -> !alive.containsKey(pid));
		if (phase == Phase.WAVE || phase == Phase.BREAK) {
			kills += before - monsters.size();
		}
		// 정리 직후의 낡은 목록이나 결과 화면에서는 새 몬스터를 받지 않는다.
		if (phase == Phase.VICTORY || phase == Phase.DEFEAT || now < ignoreNewUntil) {
			return;
		}
		// 새로 본 몬스터. 부모가 몬스터(여왕)면 부모 위치에서 태어난다.
		for (ProcessInfo p : alive.values()) {
			if (!monsters.containsKey(p.pid())) {
				Tracked parent = monsters.get(p.ppid());
				double start = parent == null ? 0 : progress(parent, now);
				monsters.put(p.pid(), new Tracked(p.comm(), p.ppid(), now, start));
			}
		}
	}

	private double progress(Tracked m, long now) {
		double travelMs = stage.monsters().get(m.kind).travelSeconds() * 1000;
		return Math.min(1.0, m.startProgress + (now - m.firstSeen) / travelMs);
	}

	private void applyDamage(long now, double dt) {
		for (Tracked m : monsters.values()) {
			if (progress(m, now) >= 1.0) {
				hp -= stage.monsters().get(m.kind).dps() * dt;
			}
		}
		hp = Math.max(0, hp);
	}

	private void finish(boolean victory, long now) {
		phase = victory ? Phase.VICTORY : Phase.DEFEAT;
		phaseStartedAt = now;
		spawnQueue.clear();
		containers.killAllMonsters(containerId);
		monsters.clear();
		ignoreNewUntil = now + 1200;

		List<GameMessages.Star> stars = List.of(
				new GameMessages.Star("스테이지 클리어", victory),
				new GameMessages.Star("코어 HP 70% 이상", victory && hp >= stage.coreHp() * 0.7),
				new GameMessages.Star("명령 " + stage.parCommands() + "개 이하", victory && commands <= stage.parCommands()));
		send.accept(new GameMessages.Result("result", victory ? "victory" : "defeat", now - stageStartedAt,
				commands, kills, hp, stage.coreHp(), stars));
		send.accept(new GameMessages.Announce(victory
				? "해냈어! 서버 코어를 지켜 냈어."
				: "서버 코어가 쓰러졌어... 다시 해 보자!", List.of()));
		sendWorld(now);
		log.info("스테이지 {} {}: 명령 {}개, 처치 {}", stage.id(), victory ? "승리" : "패배", commands, kills);
	}

	private void sendWorld(long now) {
		lastWorldAt = now;
		List<GameMessages.MonsterView> views = new ArrayList<>();
		for (Map.Entry<Integer, Tracked> e : monsters.entrySet()) {
			Tracked m = e.getValue();
			double p = progress(m, now);
			double speed = p >= 1.0 ? 0 : 1000.0 / (stage.monsters().get(m.kind).travelSeconds() * 1000);
			views.add(new GameMessages.MonsterView(e.getKey(), m.ppid, m.kind, p, speed, p >= 1.0));
		}
		long remaining = switch (phase) {
			case INTRO -> (long) (stage.introSeconds() * 1000) - (now - phaseStartedAt);
			case BREAK -> (long) (stage.breakSeconds() * 1000) - (now - phaseStartedAt);
			default -> 0;
		};
		send.accept(new GameMessages.World("world", phase.name().toLowerCase(), waveIndex + 1,
				stage.waves().size(), hp, stage.coreHp(), Math.max(0, remaining), views, kills, commands,
				now - stageStartedAt));
	}
}
