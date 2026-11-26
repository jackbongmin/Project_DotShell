package com.dotshell.engine.terminal;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import org.junit.jupiter.api.Test;

class PromptSignalParserTest {

	private static String b64(String s) {
		return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
	}

	private static String signal(int exit, long hist, String pwd, String cmd) {
		return "\u001b]777;dotshell;" + exit + ";" + hist + ";" + b64(pwd) + ";" + b64(cmd) + "\u0007";
	}

	@Test
	void 신호를_잘라내고_나머지_출력은_그대로_둔다() {
		String raw = "dungeon  welcome.txt\r\n" + signal(0, 3, "/home/hero", "ls") + "hero@dotshell:~$ ";

		PromptSignalParser.Result result = new PromptSignalParser().feed(raw.getBytes(StandardCharsets.UTF_8));

		assertEquals("dungeon  welcome.txt\r\nhero@dotshell:~$ ",
				new String(result.output(), StandardCharsets.UTF_8));
		assertEquals(List.of(new PromptSignal(0, 3, "/home/hero", "ls")), result.signals());
	}

	@Test
	void 한_바이트씩_나뉘어_와도_같은_결과() {
		String raw = "\u001b[1;32mok\u001b[0m" + signal(2, 7, "/home/hero/던전", "cat 없는파일") + "$ ";
		byte[] bytes = raw.getBytes(StandardCharsets.UTF_8);

		PromptSignalParser parser = new PromptSignalParser();
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		List<PromptSignal> signals = new ArrayList<>();
		for (byte b : bytes) {
			PromptSignalParser.Result r = parser.feed(new byte[] { b });
			out.writeBytes(r.output());
			signals.addAll(r.signals());
		}

		assertArrayEquals("\u001b[1;32mok\u001b[0m$ ".getBytes(StandardCharsets.UTF_8), out.toByteArray());
		assertEquals(List.of(new PromptSignal(2, 7, "/home/hero/던전", "cat 없는파일")), signals);
	}

	@Test
	void 다른_OSC_시퀀스는_건드리지_않는다() {
		String title = "\u001b]0;hero@dotshell: ~\u0007";

		PromptSignalParser.Result result = new PromptSignalParser().feed(title.getBytes(StandardCharsets.UTF_8));

		assertEquals(title, new String(result.output(), StandardCharsets.UTF_8));
		assertTrue(result.signals().isEmpty());
	}
}
