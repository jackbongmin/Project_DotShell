package com.dotshell.engine.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import com.dotshell.engine.terminal.TerminalWebSocketHandler;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

	private final TerminalWebSocketHandler terminalHandler;

	public WebSocketConfig(TerminalWebSocketHandler terminalHandler) {
		this.terminalHandler = terminalHandler;
	}

	@Override
	public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
		// Electron이 file:// 에서 띄운 페이지는 Origin이 "null"이라 전체 허용한다.
		// 엔진은 127.0.0.1에만 열려 있으므로 같은 PC 밖에서는 접속할 수 없다.
		registry.addHandler(terminalHandler, "/ws/terminal").setAllowedOrigins("*");
	}

	@Bean
	ServletServerContainerFactoryBean webSocketContainer() {
		ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
		container.setMaxTextMessageBufferSize(64 * 1024);     // 붙여넣기 입력
		container.setMaxBinaryMessageBufferSize(1024 * 1024);
		return container;
	}
}
