package com.dotshell.engine.terminal;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import com.dotshell.engine.container.DirectoryEntry;
import com.dotshell.engine.container.PlayerContainerService;
import com.dotshell.engine.game.StageRunner;
import com.dotshell.engine.game.StageService;
import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.async.ResultCallback;
import com.github.dockerjava.api.model.Frame;

import tools.jackson.databind.json.JsonMapper;

/**
 * 웹소켓 연결 하나 = 플레이어 컨테이너 하나 = bash 하나.
 *
 * <pre>
 * 키 입력:  웹소켓 → QueueInputStream → docker exec stdin → bash
 * 출력:    bash → docker exec stdout → PromptSignalParser → 웹소켓 (바이너리)
 * 신호:    프롬프트 훅의 OSC 777 → 디렉터리 스냅샷 → 웹소켓 (JSON state)
 * </pre>
 */
class TerminalSession {

	private static final Logger log = LoggerFactory.getLogger(TerminalSession.class);

	private static final String RIFT_DIR = PlayerContainerService.PLAYER_HOME + "/rift";
	private static final String BANNER = "\u001b[1;33m[DotShell] 서버 왕국 수호\u001b[0m\r\n"
			+ "이 터미널은 진짜 우분투 bash입니다. \u001b[36mls\u001b[0m 로 마을을 둘러보고 "
			+ "\u001b[36mcat welcome.txt\u001b[0m 로 게시판을 읽어 보세요.\r\n\r\n";

	private final WebSocketSession ws;
	private final PlayerContainerService containers;
	private final StageService stages;
	private final DockerClient docker;
	private final JsonMapper json;
	private volatile StageRunner runner;

	private final String id = UUID.randomUUID().toString().substring(0, 8);
	private final QueueInputStream stdin = new QueueInputStream();
	private final PromptSignalParser parser = new PromptSignalParser();
	private final ExecutorService snapshotExecutor =
			Executors.newSingleThreadExecutor(Thread.ofVirtual().name("snapshot-", 0).factory());

	private volatile String containerId;
	private volatile String execId;
	private volatile ResultCallback.Adapter<Frame> shellCallback;
	private volatile boolean closed;
	private volatile boolean outputStarted;
	private volatile int cols = 80;
	private volatile int rows = 24;
	private long lastHistory = -1; // 스냅샷 스레드에서만 접근

	TerminalSession(WebSocketSession ws, PlayerContainerService containers, StageService stages,
			DockerClient docker, JsonMapper json) {
		this.ws = ws;
		this.containers = containers;
		this.stages = stages;
		this.docker = docker;
		this.json = json;
	}

	String id() {
		return id;
	}

	/** 컨테이너를 만들고 bash를 붙인다. 시간이 걸리므로 별도 스레드에서 호출한다. */
	void start() {
		try {
			sendJson(new ServerMessages.Status("preparing", "플레이어 컨테이너를 준비하는 중..."));
			containers.ensureImage(() -> sendJson(new ServerMessages.Status("building",
					"처음 실행이라 플레이어 이미지를 만드는 중입니다. 1~2분 걸릴 수 있습니다...")));

			String created = containers.createPlayerContainer(id);
			containerId = created;
			if (closed) {
				containers.remove(created);
				return;
			}
			attachShell();
			sendJson(new ServerMessages.Status("ready", "준비 완료"));
			// 스테이지는 플레이어가 cd rift 로 균열에 들어갈 때 시작한다 (publishState 참고).
		} catch (RuntimeException e) {
			log.error("세션 {} 시작 실패", id, e);
			sendJson(new ServerMessages.Error(describe(e)));
			closeWebSocket(CloseStatus.SERVER_ERROR);
		}
	}

	private void attachShell() {
		execId = docker.execCreateCmd(containerId)
				.withUser(PlayerContainerService.PLAYER_USER)
				.withWorkingDir(PlayerContainerService.PLAYER_HOME)
				.withEnv(List.of("TERM=xterm-256color", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"))
				.withAttachStdin(true)
				.withAttachStdout(true)
				.withAttachStderr(true)
				.withTty(true)
				// bash가 뜨기 전에 창 크기를 맞춰 둔다. 뜬 뒤에 바꾸면 readline이 프롬프트를 한 번 더 그린다.
				.withCmd("sh", "-c", "stty cols \"$1\" rows \"$2\" 2>/dev/null; exec bash -l",
						"dotshell", String.valueOf(cols), String.valueOf(rows))
				.exec()
				.getId();

		sendBinary(BANNER.getBytes(StandardCharsets.UTF_8));

		shellCallback = docker.execStartCmd(execId)
				.withDetach(false)
				.withTty(true)
				.withStdIn(stdin)
				.exec(new ResultCallback.Adapter<Frame>() {
					@Override
					public void onNext(Frame frame) {
						onShellOutput(frame.getPayload());
					}

					@Override
					public void onError(Throwable throwable) {
						onShellEnded(throwable);
						super.onError(throwable);
					}

					@Override
					public void onComplete() {
						onShellEnded(null);
						super.onComplete();
					}
				});
	}

	/**
	 * 셸 스트림이 끝났을 때. Windows named pipe에서는 정상 exit도 IOException으로 끝나므로,
	 * exec가 실제로 종료됐는지 확인해서 정상 종료와 연결 오류를 구분한다.
	 */
	private void onShellEnded(Throwable error) {
		if (closed) {
			return;
		}
		if (error == null || shellExited()) {
			sendJson(new ServerMessages.Status("exited", "셸이 종료되었습니다."));
			closeWebSocket(CloseStatus.NORMAL);
		} else {
			log.warn("세션 {} 셸 스트림 오류: {}", id, error.toString());
			sendJson(new ServerMessages.Error("셸 연결이 끊어졌습니다: " + error.getMessage()));
			closeWebSocket(CloseStatus.SERVER_ERROR);
		}
	}

	private boolean shellExited() {
		for (int i = 0; i < 10; i++) {
			try {
				if (!Boolean.TRUE.equals(docker.inspectExecCmd(execId).exec().isRunning())) {
					return true;
				}
				Thread.sleep(100);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return false;
			} catch (RuntimeException e) {
				return false;
			}
		}
		return false;
	}

	/** docker 콜백 스레드 하나에서만 불린다. */
	private void onShellOutput(byte[] chunk) {
		PromptSignalParser.Result result = parser.feed(chunk);
		if (result.output().length > 0) {
			sendBinary(result.output());
		}
		if (!outputStarted) {
			// 출력이 왔다는 건 bash가 떠 있다는 뜻. 이제 창 크기를 맞출 수 있다.
			outputStarted = true;
			applyResize();
		}
		for (PromptSignal signal : result.signals()) {
			snapshotExecutor.execute(() -> publishState(signal));
		}
	}

	private void publishState(PromptSignal signal) {
		boolean newCommand = lastHistory >= 0 && signal.historyNumber() != lastHistory;
		lastHistory = signal.historyNumber();
		StageRunner stageRunner = runner;
		if (newCommand && stageRunner != null) {
			stageRunner.onCommand(signal.command());
		}
		try {
			List<DirectoryEntry> entries = containers.listDirectory(containerId, signal.cwd());
			sendJson(new ServerMessages.State(signal, newCommand, entries));
		} catch (RuntimeException e) {
			if (!closed) {
				log.warn("세션 {} 상태 조회 실패: {}", id, e.getMessage());
			}
		}
		updateStage(signal.cwd());
	}

	/** 균열(~/rift) 안에 있으면 스테이지를 돌리고, 밖으로 나오면 끝낸다. 스냅샷 스레드에서만 불린다. */
	private void updateStage(String cwd) {
		boolean inRift = cwd.equals(RIFT_DIR) || cwd.startsWith(RIFT_DIR + "/");
		if (inRift && runner == null && !closed) {
			log.info("세션 {} 균열 진입 → 스테이지 시작", id);
			runner = stages.start(containerId, this::sendJson);
		} else if (!inRift && runner != null) {
			log.info("세션 {} 균열 이탈 → 스테이지 종료", id);
			runner.stop();
			runner = null;
			containers.killAllMonsters(containerId);
		}
	}

	void restartStage() {
		StageRunner stageRunner = runner;
		if (stageRunner != null) {
			stageRunner.restart();
		}
	}

	void write(String data) {
		stdin.offer(data.getBytes(StandardCharsets.UTF_8));
	}

	void resize(int cols, int rows) {
		if (cols < 2 || rows < 2 || cols > 1000 || rows > 1000) {
			return;
		}
		this.cols = cols;
		this.rows = rows;
		if (outputStarted) {
			applyResize();
		}
	}

	private void applyResize() {
		String exec = execId;
		if (exec == null || closed) {
			return;
		}
		try {
			docker.resizeExecCmd(exec).withSize(rows, cols).exec();
		} catch (RuntimeException e) {
			log.debug("세션 {} 창 크기 변경 실패: {}", id, e.getMessage());
		}
	}

	/** 셸·컨테이너를 정리한다. 여러 번 불려도 안전하다. */
	void close() {
		if (closed) {
			return;
		}
		closed = true;
		StageRunner stageRunner = runner;
		if (stageRunner != null) {
			stageRunner.stop();
		}
		stdin.close();
		ResultCallback.Adapter<Frame> callback = shellCallback;
		if (callback != null) {
			try {
				callback.close();
			} catch (IOException e) {
				// 무시
			}
		}
		snapshotExecutor.shutdownNow();
		String container = containerId;
		if (container != null) {
			containers.remove(container);
		}
	}

	private void sendBinary(byte[] data) {
		if (!ws.isOpen()) {
			return;
		}
		try {
			ws.sendMessage(new BinaryMessage(data));
		} catch (IOException | IllegalStateException e) {
			log.debug("세션 {} 출력 전송 실패: {}", id, e.getMessage());
		}
	}

	private void sendJson(Object message) {
		if (!ws.isOpen()) {
			return;
		}
		try {
			ws.sendMessage(new TextMessage(json.writeValueAsString(message)));
		} catch (IOException | IllegalStateException e) {
			log.debug("세션 {} 메시지 전송 실패: {}", id, e.getMessage());
		}
	}

	private void closeWebSocket(CloseStatus status) {
		try {
			ws.close(status);
		} catch (IOException e) {
			// 무시
		}
	}

	private static String describe(Throwable e) {
		for (Throwable t = e; t != null; t = t.getCause()) {
			String msg = String.valueOf(t.getMessage());
			if (t instanceof IOException || msg.contains("pipe") || msg.contains("Connection refused")) {
				return "Docker에 연결할 수 없습니다. Docker Desktop이 실행 중인지 확인하세요. (" + msg + ")";
			}
		}
		return e.getMessage() != null ? e.getMessage() : e.toString();
	}
}
