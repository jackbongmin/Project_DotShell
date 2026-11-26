// 게임 안 터미널과 패널: xterm.js ↔ 엔진 웹소켓 ↔ 플레이어 컨테이너의 bash
// 게임 화면(Phaser)은 game.js의 window.DotGame 으로 넘긴다.
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const ENGINE_URL = params.get('engine') || 'ws://127.0.0.1:8730/ws/terminal';
  const RETRY_MS = 2000;

  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayText = $('overlay-text');
  const result = $('result');

  const term = new Terminal({
    fontFamily: 'Consolas, "D2Coding", "Malgun Gothic", monospace',
    fontSize: 15,
    cursorBlink: true,
    scrollback: 2000,
    theme: {
      background: '#0f0f1b',
      foreground: '#f4f4f4',
      cursor: '#ffd447',
      green: '#a7f070',
      blue: '#8fc1ff',
      cyan: '#73eff7',
      yellow: '#ffd447',
      red: '#ff6b6b',
      magenta: '#ef7fdc',
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('terminal'));
  fit.fit();

  let ws = null;
  let fatal = false;
  let stage = null;
  const unlocked = new Set();
  const unseen = new Set(); // 해금됐지만 아직 주문서에서 못 본 카드
  let toastTimer = 0;

  // ── 공용 ──────────────────────────────────────────────────────────
  function showOverlay(text, isError) {
    overlayText.textContent = text;
    overlay.classList.toggle('error', !!isError);
    overlay.classList.add('visible');
  }

  function hideOverlay() {
    overlay.classList.remove('visible');
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function sendResize() {
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  }

  // ── 패널 ──────────────────────────────────────────────────────────
  function addLog(command, exitCode) {
    if (!command) return;
    const li = document.createElement('li');
    li.textContent = exitCode === 0 ? command : `${command}  (실패 ${exitCode})`;
    li.className = exitCode === 0 ? 'ok' : 'fail';
    $('command-log').appendChild(li);
    while ($('command-log').children.length > 50) $('command-log').firstChild.remove();
    li.scrollIntoView({ block: 'nearest' });
  }

  function renderCards() {
    if (!stage) return;
    const box = $('cards');
    box.textContent = '';
    for (const [name, card] of Object.entries(stage.cards)) {
      const el = document.createElement('div');
      const open = unlocked.has(name);
      el.className = 'cmd-card' + (open ? '' : ' locked') + (unseen.has(name) ? ' new' : '');
      const code = document.createElement('code');
      code.textContent = open ? card.usage : '???';
      const desc = document.createElement('span');
      desc.textContent = open ? card.desc : '아직 배우지 않은 주문';
      el.append(code, desc);
      box.appendChild(el);
    }
  }

  // ── 명령어 주문서 (F1) ───────────────────────────────────────────
  function spellbookOpen() {
    return !$('spellbook').classList.contains('hidden');
  }

  function toggleSpellbook(force) {
    const open = force === undefined ? !spellbookOpen() : force;
    if (open) {
      renderCards();
      $('spellbook').classList.remove('hidden');
    } else {
      $('spellbook').classList.add('hidden');
      unseen.clear(); // 한 번 본 카드는 NEW 표시를 끈다
    }
    updateBadge();
    term.focus();
  }

  function updateBadge() {
    $('spellbook-badge').classList.toggle('hidden', unseen.size === 0);
  }

  function showToast(text) {
    const toast = $('toast');
    toast.textContent = text;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
  }

  function onStage(msg) {
    stage = msg;
    unlocked.clear();
    unseen.clear();
    msg.startCards.forEach((c) => unlocked.add(c));
    updateBadge();
    $('stage-name').textContent = `${msg.id} ${msg.title}`;
    $('quest-title').textContent = `${msg.id} ${msg.title}`;
    $('goal-wave').textContent = `웨이브 0 / ${msg.waveTotal}`;
    result.classList.add('hidden');
    renderCards();
  }

  function onAnnounce(msg) {
    $('daemon-line').textContent = msg.text;
    const fresh = (msg.unlock || []).filter((c) => !unlocked.has(c));
    if (!fresh.length) return;
    fresh.forEach((c) => { unlocked.add(c); unseen.add(c); });
    updateBadge();
    if (spellbookOpen()) renderCards();
    const names = fresh.map((c) => stage.cards[c].usage).join(', ');
    showToast(`새 주문 획득! ${names}  —  F1 로 주문서 열기`);
    const btn = $('spellbook-btn');
    btn.classList.remove('pulse');
    void btn.offsetWidth; // 애니메이션 다시 시작
    btn.classList.add('pulse');
  }

  function onWorld(msg) {
    const label = msg.phase === 'intro' ? '준비 중' : msg.phase === 'break' ? '쉬는 중' : `${msg.wave}`;
    $('goal-wave').textContent = `웨이브 ${label} / ${msg.waveTotal}`;
  }

  function onResult(msg) {
    const win = msg.outcome === 'victory';
    $('result-title').textContent = win ? '서버 코어 방어 성공!' : '서버 다운...';
    const stars = $('result-stars');
    stars.textContent = '';
    msg.stars.forEach((s) => {
      const li = document.createElement('li');
      li.className = s.earned ? 'earned' : 'missed';
      li.textContent = `${s.earned ? '★' : '☆'} ${s.label}`;
      stars.appendChild(li);
    });
    const sec = Math.round(msg.elapsedMs / 1000);
    $('result-stats').textContent =
      `시간 ${Math.floor(sec / 60)}분 ${sec % 60}초 · 명령 ${msg.commands}개 · 처치 ${msg.kills} · 코어 HP ${Math.round(msg.hp)}`;
    setTimeout(() => result.classList.remove('hidden'), 1800);
  }

  // ── 엔진 메시지 ───────────────────────────────────────────────────
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
        $('cwd').textContent = msg.cwd;
        if (msg.newCommand) addLog(msg.command, msg.exitCode);
        window.DotGame.onState(msg);
        break;
      case 'stage':
        onStage(msg);
        window.DotGame.onStage(msg);
        break;
      case 'world':
        onWorld(msg);
        window.DotGame.onWorld(msg);
        break;
      case 'announce':
        onAnnounce(msg);
        window.DotGame.onAnnounce(msg);
        break;
      case 'result':
        onResult(msg);
        window.DotGame.onResult(msg);
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
      window.DotGame.reset();
      result.classList.add('hidden');
      sendResize();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') handleJson(JSON.parse(event.data));
      else term.write(new Uint8Array(event.data));
    };

    ws.onclose = () => {
      ws = null;
      if (fatal) {
        setTimeout(connect, RETRY_MS * 3);
      } else {
        showOverlay('엔진과 연결이 끊겼습니다. 다시 연결하는 중...');
        setTimeout(connect, RETRY_MS);
      }
    };
  }

  term.onData((data) => {
    send({ type: 'input', data });
    window.DotGame.onTyping(data);
  });
  term.onResize(() => sendResize());
  new ResizeObserver(() => fit.fit()).observe($('terminal-wrap'));

  // F1 = 주문서 열기/닫기, Esc = 닫기. 캡처 단계에서 먼저 가로채서 터미널(bash)로는 보내지 않는다.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F1' || (event.key === 'Escape' && spellbookOpen())) {
      event.preventDefault();
      event.stopPropagation();
      toggleSpellbook(event.key === 'Escape' ? false : undefined);
    }
  }, true);
  // 버튼이 포커스를 가져가면 터미널에서 친 Enter가 버튼을 눌러 버린다. 누르는 순간에도 포커스를 뺏지 않게 한다.
  document.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  $('spellbook-btn').addEventListener('click', () => toggleSpellbook());
  $('spellbook').addEventListener('click', (event) => {
    if (event.target.id === 'spellbook') toggleSpellbook(false);
  });

  // 이 게임의 입력은 터미널 하나뿐이다. 게임 화면이나 패널을 눌러도 터미널로 돌아간다.
  // (글자를 드래그해서 복사하는 중이면 방해하지 않는다)
  document.addEventListener('mouseup', (event) => {
    if (event.target.closest('button') || String(window.getSelection())) return;
    term.focus();
  });
  window.addEventListener('focus', () => term.focus());

  $('retry').addEventListener('click', () => {
    result.classList.add('hidden');
    send({ type: 'restart' });
    term.focus();
  });

  connect();
})();
