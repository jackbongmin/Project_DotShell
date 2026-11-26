package com.dotshell.engine;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// 웹소켓 서버 컨테이너가 필요하므로 실제 서블릿 컨테이너를 띄운다.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EngineApplicationTests {

	@Test
	void contextLoads() {
	}

}
