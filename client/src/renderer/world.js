// 도트 세계 (프로토타입): 엔진이 보낸 디렉터리 상태를 방·문·두루마리로 그린다.
// 정식 버전에서는 Phaser + PNG 스프라이트로 바꾼다.
(function () {
  'use strict';

  const PALETTE = {
    K: '#1a1c2c', // 외곽선
    h: '#3b5dc9', // 후드
    S: '#f4c9a0', // 피부
    B: '#29366f', // 옷
    Y: '#ffcd75', // 금색
    P: '#333c57', // 신발
    d: '#6b3e26', // 어두운 나무
    D: '#a0643c', // 나무
    c: '#d9b98a', // 두루마리 말린 부분
    p: '#f4e4c1', // 종이
    L: '#94785a', // 글씨
  };

  const SPRITES = {
    hero: [
      '......KKKK......',
      '.....KhhhhK.....',
      '....KhhhhhhK....',
      '....KhSSSShK....',
      '....KhKSSKhK....',
      '....KhSSSShK....',
      '.....KSSSSK.....',
      '....KBBBBBBK....',
      '...KBBBBBBBBK...',
      '..KSKBBBBBBKSK..',
      '..KSKBBYYBBKSK..',
      '...KKBBBBBBKK...',
      '....KBBKKBBK....',
      '....KPPKKPPK....',
      '....KKKKKKKK....',
      '................',
    ],
    door: [
      '................',
      '.....KKKKKK.....',
      '...KKddddddKK...',
      '..KddDDDDDDddK..',
      '..KdDDDDDDDDdK..',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDYDdK.',
      '.KdDDDKDDKDYDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KdDDDKDDKDDDdK.',
      '.KKKKKKKKKKKKKK.',
    ],
    scroll: [
      '................',
      '..KKKKKKKKKKKK..',
      '.KccKppppppppK..',
      '.KccKpLLLLLLpK..',
      '.KKKKppppppppK..',
      '....KpLLLLLLpK..',
      '....KppppppppK..',
      '....KpLLLLpppK..',
      '....KppppppppK..',
      '....KpLLLLLLpK..',
      '....KppppppppK..',
      '....KppppppppKK.',
      '..KKKKKKKKKKccK.',
      '..KppppppppKccK.',
      '..KKKKKKKKKKKK..',
      '................',
    ],
  };

  const canvas = document.getElementById('world-canvas');
  const ctx = canvas.getContext('2d');
  const messageEl = document.getElementById('world-message');

  let state = null;          // 마지막으로 받은 상태
  let prevNames = null;      // 같은 방에 있을 때 직전 항목 이름들
  let prevCwd = null;
  let highlights = new Map(); // 이름 → 강조 시작 시각
  let failUntil = 0;
  let messageTimer = 0;

  function drawSprite(name, x, y, s, alpha) {
    const rows = SPRITES[name];
    ctx.globalAlpha = alpha;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const color = PALETTE[row[c]];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x + c * s, y + r * s, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRoom(w, h, s) {
    const t = 16 * s;
    for (let y = 0; y < h; y += t) {
      for (let x = 0; x < w; x += t) {
        const odd = ((x / t) + (y / t)) % 2 === 0;
        ctx.fillStyle = odd ? '#262a3f' : '#22253a';
        ctx.fillRect(x, y, t, t);
        ctx.fillStyle = '#1c1f30';
        ctx.fillRect(x, y, t, s);
        ctx.fillRect(x, y, s, t);
      }
    }
    // 위쪽 벽돌 벽
    const wallH = t * 1.5;
    ctx.fillStyle = '#333c57';
    ctx.fillRect(0, 0, w, wallH);
    ctx.fillStyle = '#566c86';
    const bw = 8 * s;
    const bh = 4 * s;
    for (let row = 0; row * bh < wallH; row++) {
      const offset = row % 2 === 0 ? 0 : bw / 2;
      for (let x = -offset; x < w; x += bw) {
        ctx.fillRect(x + s, row * bh + s, bw - s * 2, bh - s * 2);
      }
    }
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, wallH, w, s * 2);
    return wallH;
  }

  function label(text, cx, y, color) {
    ctx.font = '13px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const shown = text.length > 14 ? text.slice(0, 13) + '…' : text;
    ctx.fillStyle = 'rgba(15,16,32,0.75)';
    const tw = ctx.measureText(shown).width;
    ctx.fillRect(cx - tw / 2 - 4, y - 2, tw + 8, 18);
    ctx.fillStyle = color;
    ctx.fillText(shown, cx, y);
  }

  function render(now) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const s = 3;           // 도트 1칸 = 화면 3px
    const t = 16 * s;      // 타일 한 칸
    const wallH = drawRoom(w, h, s);

    if (!state) {
      requestAnimationFrame(render);
      return;
    }

    // 주인공은 왼쪽에 선다. 위에는 현재 위치 표지판.
    const heroX = t * 0.75;
    const heroY = wallH + t * 1.2;
    const bob = Math.round(Math.sin(now / 400) * 1) * s;
    drawSprite('hero', heroX, heroY + bob, s, 1);
    label(state.cwd, heroX + t / 2, heroY - 26, '#73eff7');
    if (now < failUntil) {
      ctx.fillStyle = '#ef7d57';
      ctx.font = 'bold 22px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', heroX + t + 6, heroY - 4);
    }

    // 방 안의 물건: 문(디렉터리)과 두루마리(파일)
    const startX = heroX + t * 2;
    const cellW = t * 2;
    const cellH = t * 1.9;
    const cols = Math.max(1, Math.floor((w - startX - t * 0.5) / cellW));
    state.entries.forEach((entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellW + (cellW - t) / 2;
      const y = wallH + t * 0.6 + row * cellH;
      if (y > h) return;

      const started = highlights.get(entry.name);
      if (started !== undefined) {
        const age = now - started;
        if (age < 1500) {
          const a = 0.6 * (1 - age / 1500);
          ctx.fillStyle = `rgba(255, 205, 117, ${a})`;
          ctx.fillRect(x - s * 3, y - s * 3, t + s * 6, t + s * 6);
        } else {
          highlights.delete(entry.name);
        }
      }

      const sprite = entry.kind === 'dir' ? 'door' : 'scroll';
      drawSprite(sprite, x, y, s, entry.hidden ? 0.55 : 1);
      if (entry.hidden) {
        // 숨겨진 물건은 반짝인다
        const phase = Math.floor(now / 250) % 4;
        ctx.fillStyle = '#ffffff';
        const sx = x + t - s * (2 + phase);
        const sy = y + s * (1 + phase);
        ctx.fillRect(sx, sy, s, s);
        ctx.fillRect(sx - s, sy + s, s * 3, s);
        ctx.fillRect(sx, sy + s * 2, s, s);
      }
      label(entry.name + (entry.kind === 'dir' ? '/' : ''), x + t / 2, y + t + 4,
        entry.kind === 'dir' ? '#ffcd75' : '#f4f4f4');
    });

    if (state.entries.length === 0) {
      ctx.fillStyle = '#94b0c2';
      ctx.font = '14px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('텅 빈 방이다.', startX, wallH + t);
    }

    requestAnimationFrame(render);
  }

  function showMessage(text, fail) {
    messageEl.textContent = text;
    messageEl.classList.toggle('fail', !!fail);
    messageEl.classList.add('visible');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => messageEl.classList.remove('visible'), 3500);
  }

  /** 엔진의 state 메시지를 받아 직전 상태와 비교한다. */
  function applyState(next) {
    const names = new Set(next.entries.map((e) => e.name));
    const now = performance.now();

    if (next.newCommand) {
      if (next.exitCode !== 0) {
        failUntil = now + 2000;
        showMessage(`명령이 실패했다 (종료 코드 ${next.exitCode}). 힌트 NPC가 곧 도와줄 거야.`, true);
      } else if (prevCwd !== null && prevCwd !== next.cwd) {
        showMessage(`🚪 이동: ${prevCwd} → ${next.cwd}`);
      } else if (prevNames) {
        const added = [...names].filter((n) => !prevNames.has(n));
        const removed = [...prevNames].filter((n) => !names.has(n));
        added.forEach((n) => highlights.set(n, now));
        const parts = [];
        if (added.length) parts.push(`✨ 생김: ${added.join(', ')}`);
        if (removed.length) parts.push(`💥 사라짐: ${removed.join(', ')}`);
        if (parts.length) showMessage(parts.join('   '));
      }
    }

    prevNames = names;
    prevCwd = next.cwd;
    state = next;
  }

  window.DotWorld = { applyState };
  requestAnimationFrame(render);
})();
