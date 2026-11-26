package com.dotshell.engine.terminal;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * 터미널 출력 바이트 스트림에서 DotShell 신호(OSC 777)를 잘라내는 파서.
 *
 * <pre>ESC ] 777 ; dotshell ; 종료코드 ; 히스토리번호 ; base64(PWD) ; base64(명령어) BEL</pre>
 *
 * 신호가 여러 청크에 걸쳐 나뉘어 와도 처리할 수 있도록 상태를 유지한다.
 * 한 세션 안에서 한 스레드만 호출한다고 가정한다.
 */
public class PromptSignalParser {

	private static final byte ESC = 0x1b;
	private static final byte BEL = 0x07;
	private static final byte[] PREFIX = "\u001b]777;dotshell;".getBytes(StandardCharsets.US_ASCII);
	private static final int MAX_PAYLOAD = 64 * 1024;

	private enum State { NORMAL, PREFIX, PAYLOAD, PAYLOAD_ESC }

	public record Result(byte[] output, List<PromptSignal> signals) {
	}

	private State state = State.NORMAL;
	private final ByteArrayOutputStream prefixBuf = new ByteArrayOutputStream();
	private final ByteArrayOutputStream payloadBuf = new ByteArrayOutputStream();

	public Result feed(byte[] chunk) {
		ByteArrayOutputStream out = new ByteArrayOutputStream(chunk.length);
		List<PromptSignal> signals = new ArrayList<>();

		for (byte b : chunk) {
			switch (state) {
				case NORMAL -> {
					if (b == ESC) {
						prefixBuf.reset();
						prefixBuf.write(b);
						state = State.PREFIX;
					} else {
						out.write(b);
					}
				}
				case PREFIX -> {
					int pos = prefixBuf.size();
					if (b == PREFIX[pos]) {
						prefixBuf.write(b);
						if (prefixBuf.size() == PREFIX.length) {
							payloadBuf.reset();
							state = State.PAYLOAD;
						}
					} else {
						// 우리 신호가 아니다. 모아 둔 바이트를 그대로 내보낸다.
						out.writeBytes(prefixBuf.toByteArray());
						if (b == ESC) {
							prefixBuf.reset();
							prefixBuf.write(b);
						} else {
							out.write(b);
							state = State.NORMAL;
						}
					}
				}
				case PAYLOAD -> {
					if (b == BEL) {
						finish(signals);
					} else if (b == ESC) {
						state = State.PAYLOAD_ESC;
					} else if (payloadBuf.size() < MAX_PAYLOAD) {
						payloadBuf.write(b);
					} else {
						state = State.NORMAL; // 비정상적으로 긴 신호는 버린다
					}
				}
				case PAYLOAD_ESC -> finish(signals); // ESC \ (ST) 종료
			}
		}
		return new Result(out.toByteArray(), signals);
	}

	private void finish(List<PromptSignal> signals) {
		state = State.NORMAL;
		PromptSignal signal = decode(payloadBuf.toString(StandardCharsets.US_ASCII));
		if (signal != null) {
			signals.add(signal);
		}
	}

	static PromptSignal decode(String payload) {
		String[] parts = payload.split(";", -1);
		if (parts.length != 4) {
			return null;
		}
		try {
			int exitCode = Integer.parseInt(parts[0]);
			long history = Long.parseLong(parts[1]);
			String cwd = b64(parts[2]);
			String command = b64(parts[3]);
			return new PromptSignal(exitCode, history, cwd, command);
		} catch (IllegalArgumentException e) {
			return null;
		}
	}

	private static String b64(String s) {
		return new String(Base64.getDecoder().decode(s), StandardCharsets.UTF_8);
	}
}
