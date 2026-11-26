package com.dotshell.engine.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 플레이어 컨테이너 설정.
 *
 * @param image        플레이어 컨테이너 이미지 태그
 * @param buildContext 이미지가 없을 때 빌드할 Dockerfile 폴더
 * @param memoryMb     컨테이너 메모리 상한 (MB)
 * @param cpus         컨테이너 CPU 상한 (코어 수)
 * @param pidsLimit    컨테이너 안 프로세스 수 상한 (fork 폭탄 방지)
 */
@ConfigurationProperties("dotshell.player")
public record PlayerProperties(
		String image,
		String buildContext,
		long memoryMb,
		double cpus,
		long pidsLimit) {
}
