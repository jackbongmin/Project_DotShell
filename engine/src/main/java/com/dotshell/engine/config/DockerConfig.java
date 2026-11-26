package com.dotshell.engine.config;

import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.core.DefaultDockerClientConfig;
import com.github.dockerjava.core.DockerClientConfig;
import com.github.dockerjava.core.DockerClientImpl;
import com.github.dockerjava.httpclient5.ApacheDockerHttpClient;
import com.github.dockerjava.transport.DockerHttpClient;

@Configuration
public class DockerConfig {

	/**
	 * Docker Engine 클라이언트.
	 * DOCKER_HOST가 없으면 Windows에서는 npipe:////./pipe/docker_engine 으로 접속한다.
	 */
	@Bean(destroyMethod = "close")
	DockerClient dockerClient() {
		DockerClientConfig config = DefaultDockerClientConfig.createDefaultConfigBuilder().build();
		DockerHttpClient httpClient = new ApacheDockerHttpClient.Builder()
				.dockerHost(config.getDockerHost())
				.sslConfig(config.getSSLConfig())
				.maxConnections(100)
				.connectionTimeout(Duration.ofSeconds(10))
				.build();
		return DockerClientImpl.getInstance(config, httpClient);
	}
}
