// 게임 안 터미널: xterm.js ↔ 엔진 웹소켓 ↔ 플레이어 컨테이너의 bash
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const ENGINE_URL = params.get('engine') || 'ws://127.0.0.1:8730/ws/terminal';
  const RETRY_MS = 2000;

  const overlay = document.getElementById('overlay');
  const overlayText = document.getElementById('overlay-text');
  const cwdEl = document.getElementById('cwd');
  const logEl = document.getElementById('command-log');

  const term = new Terminal({
    fontFamily: 'Consolas, "D2Coding", "Malgun Gothic", monospace',
    fontSize: 15,
    cursorBlink: true,
    scrollback: 2000,
    theme: {
      background: '#0a0a14',
      foreground: '#f4f4f4',
      cursor: '#ffcd75',
      green: '#a7f070',
      blue: '#41a6f6',
      cyan: '#73eff7',
      yellow: '#ffcd75',
      red: '#ef7d57',
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('terminal'));
  fit.fit();

  let ws = null;
  let fatal = false;

  function showOverlay(text, isError) {
    overlayText.textContent = text;
    overlay.classList.toggle('error', !!isError);
    overlay.classList.add('visible');
  }

  function hideOverlay() {
    overlay.classList.remove('visible');
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function sendResize() {
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  }

  function addLog(command, exitCode) {
    if (!command) return;
    const li = document.createElement('li');
    li.textContent = exitCode === 0 ? command : `${command}  (실패 ${exitCode})`;
    li.className = exitCode === 0 ? 'ok' : 'fail';
    logEl.appendChild(li);
    while (logEl.children.length > 50) logEl.firstChild.remove();
    li.scrollIntoView({ block: 'nearest' });
  }

  function handleJson(msg) {
    switch (msg.type) {
      case 'status':
        if (msg.phase === 'ready') {
          hideOverlay();
          term.focus();
        } else {
          showOverlay(msg.message);
        }
        break;
      case 'error':
        fatal = true;
        showOverlay(msg.message, true);
        break;
      case 'state':
        cwdEl.textContent = msg.cwd;
        if (msg.newCommand) addLog(msg.command, msg.exitCode);
        window.DotWorld.applyState(msg);
        break;
    }
  }

  function connect() {
    showOverlay('엔진에 연결하는 중...');
    fatal = false;
    ws = new WebSocket(ENGINE_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      term.reset();
      sendResize();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        handleJson(JSON.parse(event.data));
      } else {
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onclose = () => {
      ws = null;
      if (fatal) {
        // 오류 메시지를 잠시 보여 준 뒤 다시 시도한다.
        setTimeout(connect, RETRY_MS * 3);
      } else {
        showOverlay('엔진과 연결이 끊겼습니다. 다시 연결하는 중...');
        setTimeout(connect, RETRY_MS);
      }
    };
  }

  term.onData((data) => send({ type: 'input', data }));
  term.onResize(() => sendResize());
  new ResizeObserver(() => fit.fit()).observe(document.getElementById('terminal-wrap'));

  connect();
})();
