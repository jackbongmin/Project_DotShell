package com.dotshell.engine.terminal;

import java.io.InputStream;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * 웹소켓으로 들어온 키 입력을 docker exec의 stdin으로 넘기는 스트림.
 * PipedInputStream은 쓰는 쪽 스레드가 바뀌면 깨지기 쉬워서 큐로 직접 구현한다.
 */
class QueueInputStream extends InputStream {

	private static final byte[] EOF = new byte[0];

	private final BlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
	private byte[] current;
	private int pos;
	private volatile boolean closed;

	void offer(byte[] data) {
		if (!closed && data.length > 0) {
			queue.offer(data);
		}
	}

	@Override
	public int read() {
		byte[] one = new byte[1];
		int n = read(one, 0, 1);
		return n == -1 ? -1 : one[0] & 0xff;
	}

	@Override
	public int read(byte[] b, int off, int len) {
		if (len == 0) {
			return 0;
		}
		if (current == null || pos >= current.length) {
			try {
				current = queue.take();
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return -1;
			}
			pos = 0;
			if (current == EOF) {
				queue.offer(EOF); // 이후 read도 계속 EOF
				return -1;
			}
		}
		int n = Math.min(len, current.length - pos);
		System.arraycopy(current, pos, b, off, n);
		pos += n;
		return n;
	}

	@Override
	public int available() {
		return current == null ? 0 : current.length - pos;
	}

	@Override
	public void close() {
		closed = true;
		queue.offer(EOF);
	}
}
