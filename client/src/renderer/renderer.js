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
  const unlocked = new Set(['ls', 'cd']);
  const unseen = new Set(); // 해금됐지만 아직 주문서에서 못 본 카드
  let toastTimer = 0;
  let inRift = false;
  let paused = false;
  let wave = { label: '준비 중', total: 0 };

  // 마을에서 쓰는 기본 주문. 처음 성공하면 주문서에 새겨진다 (직접 해 봐야 배운다).
  const VILLAGE_CARDS = {
    ls: { usage: 'ls -al', desc: '주변을 본다. -a 숨은 것까지, -l 자세히' },
    cd: { usage: 'cd <이름> · cd ..', desc: '건물(디렉터리)에 들어가고 나온다' },
    pwd: { usage: 'pwd', desc: '지금 있는 곳의 전체 경로' },
    cat: { usage: 'cat <파일>', desc: '두루마리(파일)를 읽는다' },
    touch: { usage: 'touch <파일>', desc: '빈 파일을 만든다' },
    mkdir: { usage: 'mkdir <이름>', desc: '새 건물(디렉터리)을 짓는다' },
    cp: { usage: 'cp <원본> <사본>', desc: '복사한다 (디렉터리는 cp -r)' },
    mv: { usage: 'mv <원본> <대상>', desc: '옮기거나 이름을 바꾼다' },
    rm: { usage: 'rm <파일>', desc: '부순다 (디렉터리는 rm -r). 되돌릴 수 없다' },
  };
  const allCards = () => ({ ...VILLAGE_CARDS, ...(stage ? stage.cards : {}) });

  // 마을 퀘스트
  const goals = [
    { id: 'board', text: '게시판 읽기', how: 'cat welcome.txt', done: false },
    { id: 'library', text: '도서관 가 보기', how: 'cd library', done: false },
    { id: 'rift', text: '균열에 들어가기', how: 'cd rift', done: false },
  ];

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

  function renderQuest() {
    const list = $('goals');
    list.textContent = '';
    const add = (html, done) => {
      const li = document.createElement('li');
      li.innerHTML = html;
      if (done) li.className = 'done';
      list.appendChild(li);
    };
    if (inRift && stage) {
      $('quest-title').textContent = `${stage.id} ${stage.title}`;
      add('서버 코어를 지켜라');
      add(`웨이브 ${wave.label} / ${wave.total}`);
    } else {
      $('quest-title').textContent = '마을 탐험';
      goals.forEach((g) => add(`${g.text} <code>${g.how}</code>`, g.done));
    }
    $('stage-name').textContent = inRift && stage ? `${stage.id} ${stage.title}` : '마을';
  }

  function checkGoals(msg) {
    const { word, args } = DS.parseCommand(msg.command);
    const mark = (id) => {
      const g = goals.find((x) => x.id === id);
      if (g && !g.done) {
        g.done = true;
        showToast(`퀘스트 완료: ${g.text}`);
      }
    };
    if (msg.exitCode === 0 && word === 'cat' && args.some((a) => /welcome\.txt$/.test(a))) mark('board');
    if (msg.cwd === `${DS.HOME}/library`) mark('library');
    if (DS.inRift(msg.cwd)) mark('rift');
  }

  /** 처음 성공한 기본 명령은 주문서에 새긴다. */
  function learn(msg) {
    if (!msg.newCommand || msg.exitCode !== 0) return;
    const { word } = DS.parseCommand(msg.command);
    if (VILLAGE_CARDS[word] && !unlocked.has(word)) unlockCards([word]);
  }

  function unlockCards(names) {
    const fresh = names.filter((c) => !unlocked.has(c));
    if (!fresh.length) return;
    fresh.forEach((c) => { unlocked.add(c); unseen.add(c); });
    updateBadge();
    if (spellbookOpen()) renderCards();
    const cards = allCards();
    showToast(`새 주문 획득! ${fresh.map((c) => cards[c].usage).join(', ')}  —  F1 로 주문서 열기`);
    const btn = $('spellbook-btn');
    btn.classList.remove('pulse');
    void btn.offsetWidth; // 애니메이션 다시 시작
    btn.classList.add('pulse');
  }

  /** 방금 끝난 명령의 출력(cat 내용 등)을 터미널 화면에서 읽어 온다. */
  function extractOutput(command, max = 12) {
    const buf = term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const lines = [];
    for (let i = end - 1; i >= Math.max(0, end - 200); i--) {
      const line = buf.getLine(i);
      const text = line ? line.translateToString(true) : '';
      if (text.endsWith(`$ ${command}`) || text.includes(`$ ${command}`)) break;
      if (/^\S+@dotshell:.*\$ ?$/.test(text)) continue; // 새 프롬프트 줄
      lines.unshift(text);
    }
    return lines.slice(0, max);
  }

  function renderCards() {
    const box = $('cards');
    box.textContent = '';
    const entries = Object.entries(allCards()).sort(([a], [b]) => Number(unlocked.has(b)) - Number(unlocked.has(a)));
    for (const [name, card] of entries) {
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
    if (open !== paused) {
      // 주문서를 펼친 동안은 일시정지: 전투 시간과 몬스터(SIGSTOP)가 멈추고 입력도 막힌다.
      paused = open;
      send({ type: open ? 'pause' : 'resume' });
      window.DotGame.setPaused(open);
    }
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
    msg.startCards.forEach((c) => unlocked.add(c));
    wave = { label: '준비 중', total: msg.waveTotal };
    result.classList.add('hidden');
    renderQuest();
  }

  function onAnnounce(msg) {
    $('daemon-line').textContent = msg.text;
    unlockCards(msg.unlock || []);
  }

  function onWorld(msg) {
    const label = msg.phase === 'intro' ? '준비 중' : msg.phase === 'break' ? '쉬는 중' : `${msg.wave}`;
    if (label !== wave.label) {
      wave = { label, total: msg.waveTotal };
      renderQuest();
    }
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
      case 'state': {
        $('cwd').textContent = msg.cwd;
        if (msg.newCommand) {
          addLog(msg.command, msg.exitCode);
          if (/^(cat|less|more|head|tail)$/.test(DS.parseCommand(msg.command).word)) msg.output = extractOutput(msg.command);
        }
        const nowInRift = DS.inRift(msg.cwd);
        if (nowInRift !== inRift) {
          inRift = nowInRift;
          if (!inRift) result.classList.add('hidden');
        }
        checkGoals(msg);
        learn(msg);
        renderQuest();
        window.DotGame.onState(msg);
        break;
      }
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
      if (paused) toggleSpellbook(false);
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
    if (paused) {
      showToast('일시정지 중이에요 — F1 또는 Esc 로 돌아가면 입력할 수 있어요');
      return;
    }
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

  renderQuest();
  connect();
})();
