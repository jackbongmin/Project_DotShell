package com.dotshell.engine.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import tools.jackson.databind.json.JsonMapper;

class StageDefinitionTest {

	@Test
	void 스테이지_1_1을_읽는다() throws Exception {
		StageDefinition stage;
		try (InputStream in = new ClassPathResource("stages/1-1.json").getInputStream()) {
			stage = JsonMapper.builder().build().readValue(in, StageDefinition.class);
		}

		assertEquals("버그 습격", stage.title());
		assertEquals(3, stage.waves().size());
		// 웨이브에 나오는 몬스터와 해금 카드는 모두 정의되어 있어야 한다.
		for (StageDefinition.Wave wave : stage.waves()) {
			wave.spawns().forEach(s -> assertNotNull(stage.monsters().get(s.kind()), s.kind()));
			wave.unlock().forEach(card -> assertTrue(stage.cards().containsKey(card), card));
		}
		stage.startCards().forEach(card -> assertTrue(stage.cards().containsKey(card), card));
		// 몬스터 이름은 균열이 받아 주는 형식(소문자와 -)이어야 한다.
		stage.monsters().keySet().forEach(kind -> assertTrue(kind.matches("[a-z-]+"), kind));
		assertEquals(java.util.List.of("infinity"), stage.monsters().get("bug").args());
	}
}
