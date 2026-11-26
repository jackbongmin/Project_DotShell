package com.dotshell.engine.terminal;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import com.dotshell.engine.container.PlayerContainerService;
import com.dotshell.engine.game.StageService;
import com.github.dockerjava.api.DockerClient;

import jakarta.annotation.PreDestroy;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 게임 안 터미널(xterm.js)과 플레이어 컨테이너를 잇는 웹소켓 핸들러.
 *
 * 클라이언트 → 엔진 (텍스트 JSON):
 * <pre>
 * {"type":"input",  "data":"ls\r"}
 * {"type":"resize", "cols":120, "rows":30}
 * {"type":"restart"}   스테이지 다시 시작
 * </pre>
 */
@Component
public class TerminalWebSocketHandler extends AbstractWebSocketHandler {

	private static final Logger log = LoggerFactory.getLogger(TerminalWebSocketHandler.class);

	private final PlayerContainerService containers;
	private final StageService stages;
	private final DockerClient docker;
	private final JsonMapper json;
	private final Map<String, TerminalSession> sessions = new ConcurrentHashMap<>();

	public TerminalWebSocketHandler(PlayerContainerService containers, StageService stages, DockerClient docker,
			JsonMapper json) {
		this.containers = containers;
		this.stages = stages;
		this.docker = docker;
		this.json = json;
	}

	@Override
	public void afterConnectionEstablished(WebSocketSession session) {
		// docker 콜백 스레드와 스냅샷 스레드가 동시에 보내므로 스레드 안전 래퍼로 감싼다.
		WebSocketSession safe = new ConcurrentWebSocketSessionDecorator(session, 10_000, 4 * 1024 * 1024);
		TerminalSession terminal = new TerminalSession(safe, containers, stages, docker, json);
		sessions.put(session.getId(), terminal);
		log.info("터미널 연결: 세션 {}", terminal.id());
		Thread.ofVirtual().name("terminal-start-" + terminal.id()).start(terminal::start);
	}

	@Override
	protected void handleTextMessage(WebSocketSession session, TextMessage message) {
		TerminalSession terminal = sessions.get(session.getId());
		if (terminal == null) {
			return;
		}
		try {
			JsonNode node = json.readTree(message.getPayload());
			switch (node.path("type").asString()) {
				case "input" -> terminal.write(node.path("data").asString());
				case "resize" -> terminal.resize(node.path("cols").asInt(), node.path("rows").asInt());
				case "restart" -> terminal.restartStage();
				default -> log.debug("알 수 없는 메시지: {}", message.getPayload());
			}
		} catch (JacksonException e) {
			log.debug("잘못된 JSON: {}", message.getPayload());
		}
	}

	@Override
	public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
		TerminalSession terminal = sessions.remove(session.getId());
		if (terminal != null) {
			log.info("터미널 연결 종료: 세션 {} ({})", terminal.id(), status);
			Thread.ofVirtual().name("terminal-close-" + terminal.id()).start(terminal::close);
		}
	}

	@PreDestroy
	void closeAll() {
		sessions.values().forEach(TerminalSession::close);
		sessions.clear();
	}
}
