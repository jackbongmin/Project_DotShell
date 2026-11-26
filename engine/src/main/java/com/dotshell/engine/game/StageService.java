package com.dotshell.engine.game;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.function.Consumer;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import com.dotshell.engine.container.PlayerContainerService;

import tools.jackson.databind.json.JsonMapper;

/** 스테이지 파일을 읽고 세션마다 러너를 만든다. */
@Service
public class StageService {

	/** 프로토타입은 첫 스테이지만. 스테이지 선택은 다음 단계에서. */
	private static final String FIRST_STAGE = "1-1";

	private final PlayerContainerService containers;
	private final JsonMapper json;

	public StageService(PlayerContainerService containers, JsonMapper json) {
		this.containers = containers;
		this.json = json;
	}

	public StageDefinition load(String id) {
		try (InputStream in = new ClassPathResource("stages/" + id + ".json").getInputStream()) {
			return json.readValue(in, StageDefinition.class);
		} catch (IOException e) {
			throw new UncheckedIOException("스테이지 " + id + "를 읽지 못했습니다", e);
		}
	}

	public StageRunner start(String containerId, Consumer<Object> send) {
		StageRunner runner = new StageRunner(load(FIRST_STAGE), containerId, containers, send);
		runner.start();
		return runner;
	}
}
