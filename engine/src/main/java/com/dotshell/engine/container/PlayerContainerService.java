package com.dotshell.engine.container;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import com.dotshell.engine.config.PlayerProperties;
import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.async.ResultCallback;
import com.github.dockerjava.api.command.BuildImageResultCallback;
import com.github.dockerjava.api.command.CreateContainerResponse;
import com.github.dockerjava.api.exception.NotFoundException;
import com.github.dockerjava.api.model.BuildResponseItem;
import com.github.dockerjava.api.model.Container;
import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.HostConfig;
import com.github.dockerjava.api.model.StreamType;

/**
 * 플레이어 컨테이너의 생성·삭제와 상태 조회를 맡는다.
 */
@Service
public class PlayerContainerService {

	private static final Logger log = LoggerFactory.getLogger(PlayerContainerService.class);

	static final String ROLE_LABEL = "dotshell.role";
	static final String SESSION_LABEL = "dotshell.session";
	public static final String PLAYER_USER = "hero";
	public static final String PLAYER_HOME = "/home/hero";
	private static final int MAX_ENTRIES = 200;

	private final DockerClient docker;
	private final PlayerProperties props;

	public PlayerContainerService(DockerClient docker, PlayerProperties props) {
		this.docker = docker;
		this.props = props;
	}

	/** 엔진이 비정상 종료되어 남은 플레이어 컨테이너를 정리한다. */
	@EventListener(ApplicationReadyEvent.class)
	public void removeLeftoverContainers() {
		try {
			List<Container> leftovers = docker.listContainersCmd()
					.withShowAll(true)
					.withLabelFilter(Map.of(ROLE_LABEL, "player"))
					.exec();
			for (Container c : leftovers) {
				remove(c.getId());
			}
			if (!leftovers.isEmpty()) {
				log.info("남아 있던 플레이어 컨테이너 {}개를 정리했습니다.", leftovers.size());
			}
		} catch (RuntimeException e) {
			log.warn("Docker에 연결하지 못해 잔여 컨테이너 정리를 건너뜁니다: {}", e.getMessage());
		}
	}

	/** 이미지가 있으면 true, 없어서 새로 빌드했으면 false. */
	public synchronized boolean ensureImage(Runnable onBuildStart) {
		try {
			docker.inspectImageCmd(props.image()).exec();
			return true;
		} catch (NotFoundException e) {
			// 아래에서 빌드
		}

		Path context = Path.of(props.buildContext()).toAbsolutePath().normalize();
		if (!Files.isRegularFile(context.resolve("Dockerfile"))) {
			throw new IllegalStateException("플레이어 이미지가 없고, Dockerfile도 찾을 수 없습니다: " + context);
		}
		onBuildStart.run();
		log.info("플레이어 이미지 {} 빌드 시작: {}", props.image(), context);
		String imageId = docker.buildImageCmd(context.toFile())
				.withTags(Set.of(props.image()))
				.exec(new BuildImageResultCallback() {
					@Override
					public void onNext(BuildResponseItem item) {
						if (item.getStream() != null && !item.getStream().isBlank()) {
							log.info("[build] {}", item.getStream().strip());
						}
						super.onNext(item);
					}
				})
				.awaitImageId();
		log.info("플레이어 이미지 빌드 완료: {}", imageId);
		return false;
	}

	/** 새 플레이어 컨테이너를 만들고 시작한 뒤 컨테이너 ID를 돌려준다. */
	public String createPlayerContainer(String sessionId) {
		long memoryBytes = props.memoryMb() * 1024L * 1024L;
		HostConfig hostConfig = HostConfig.newHostConfig()
				.withMemory(memoryBytes)
				.withMemorySwap(memoryBytes)
				.withNanoCPUs((long) (props.cpus() * 1_000_000_000L))
				.withPidsLimit(props.pidsLimit())
				// 외부 인터넷 차단. Gitea·Floci를 붙일 때 게임 전용 내부 네트워크로 바꾼다.
				.withNetworkMode("none");

		CreateContainerResponse created = docker.createContainerCmd(props.image())
				.withName("dotshell-player-" + sessionId)
				.withHostName("dotshell")
				.withLabels(Map.of(ROLE_LABEL, "player", SESSION_LABEL, sessionId))
				.withHostConfig(hostConfig)
				.exec();
		docker.startContainerCmd(created.getId()).exec();
		log.info("플레이어 컨테이너 시작: {} (세션 {})", shortId(created.getId()), sessionId);
		return created.getId();
	}

	public void remove(String containerId) {
		try {
			docker.removeContainerCmd(containerId).withForce(true).exec();
			log.info("플레이어 컨테이너 삭제: {}", shortId(containerId));
		} catch (NotFoundException e) {
			// 이미 없음
		} catch (RuntimeException e) {
			log.warn("컨테이너 {} 삭제 실패: {}", shortId(containerId), e.getMessage());
		}
	}

	/** 디렉터리 바로 아래 항목 목록. 도트 화면의 "방 안 물건"이 된다. */
	public List<DirectoryEntry> listDirectory(String containerId, String path) {
		String out = execCapture(containerId,
				"find", path, "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\\t%f\\n");
		List<DirectoryEntry> entries = new ArrayList<>();
		for (String line : out.split("\n")) {
			DirectoryEntry entry = DirectoryEntry.fromFindLine(line);
			if (entry != null) {
				entries.add(entry);
			}
			if (entries.size() >= MAX_ENTRIES) {
				break;
			}
		}
		entries.sort(Comparator
				.comparing((DirectoryEntry e) -> !e.kind().equals("dir"))
				.thenComparing(DirectoryEntry::name));
		return entries;
	}

	/** 플레이어 권한으로 명령을 실행하고 표준 출력을 돌려준다. 셸을 거치지 않으므로 인자 따옴표 걱정이 없다. */
	public String execCapture(String containerId, String... cmd) {
		String execId = docker.execCreateCmd(containerId)
				.withUser(PLAYER_USER)
				.withAttachStdout(true)
				.withAttachStderr(true)
				.withCmd(cmd)
				.exec()
				.getId();
		ByteArrayOutputStream stdout = new ByteArrayOutputStream();
		try {
			boolean finished = docker.execStartCmd(execId)
					.exec(new ResultCallback.Adapter<Frame>() {
						@Override
						public void onNext(Frame frame) {
							if (frame.getStreamType() == StreamType.STDOUT) {
								stdout.writeBytes(frame.getPayload());
							}
						}
					})
					.awaitCompletion(10, TimeUnit.SECONDS);
			if (!finished) {
				log.warn("상태 조회 명령이 시간 안에 끝나지 않았습니다: {}", String.join(" ", cmd));
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		return stdout.toString(StandardCharsets.UTF_8);
	}

	public static String shortId(String containerId) {
		Objects.requireNonNull(containerId);
		return containerId.length() > 12 ? containerId.substring(0, 12) : containerId;
	}
}
