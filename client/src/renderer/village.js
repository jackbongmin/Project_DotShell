// 마을 장면: 디렉터리 = 장소. 명령어를 치면 주인공이 직접 걸어가서 행동한다.
//
//   ~ (홈)        마을 광장 (야외). 하위 디렉터리는 집, rift 는 균열 문
//   ~/아래 폴더    건물 안 (실내). 하위 디렉터리는 문, 아래쪽 문이 .. (나가기)
//   ~ 바깥        바깥 세계 (어두운 야외)
//
//   cd 이름   그 집(문)까지 걸어가서 들어간다      cd ..  출구로 걸어가서 나간다
//   ls        횃불을 들어 장소를 밝힌다 (-a 는 숨은 보물까지)
//   cat 파일  그 두루마리까지 걸어가서 읽는다 (내용이 양피지로 뜬다)
//   touch / mkdir  물건을 놓는다 / 집을 짓는다
//   rm        걸어가서 검으로 부순다
//   mv / cp   들고 옮긴다 / 복제한다
(function () {
  'use strict';
  const { S, TILE, COLS, ROWS, W, H, FONT, HOME, RIFT, hash, hashStr, parseCommand, basename, burst, floatText } = DS;

  const ENV = { grass: [0, 17, 34, 51], flower: 68, tree: [13, 14], path: 87, floor: 25, sign: 67 };
  const WALL = 7; // 해적 팩의 어두운 나무 벽 = 실내 벽
  const HOUSES = ['house_red', 'house_blue', 'house_green', 'house_gold'];
  const WALK_SPEED = 300; // px/s
  const RUNE_COLORS = ['#73eff7', '#ffd447', '#ef7fdc', '#a7f070', '#ffffff'];

  function placeType(cwd) {
    if (cwd === HOME) return 'square';
    if (cwd.startsWith(`${HOME}/`)) return 'room';
    return 'wild';
  }

  function placeName(cwd) {
    if (cwd === HOME) return '마을 광장';
    if (cwd === '/') return '세계의 뿌리';
    if (cwd.startsWith(`${HOME}/`)) return `${basename(cwd)} 안`;
    return '바깥 세계';
  }

  function relation(from, to) {
    if (from === null) return { type: 'init' };
    if (from === to) return { type: 'same' };
    const under = (a, b) => b.startsWith(a === '/' ? '/' : `${a}/`);
    if (under(from, to)) {
      const rest = to.slice(from === '/' ? 1 : from.length + 1);
      return { type: 'down', first: rest.split('/')[0], deep: rest.includes('/') };
    }
    if (under(to, from)) {
      const rest = from.slice(to === '/' ? 1 : to.length + 1);
      return { type: 'up', child: rest.split('/')[0] };
    }
    return { type: 'jump' };
  }

  /** 디렉터리는 위쪽 줄(집·문), 파일은 아래쪽 줄에 놓는다. */
  function layout(type, entries) {
    const outdoor = type !== 'room';
    const pos = new Map();
    entries.filter((e) => e.kind === 'dir').slice(0, 7).forEach((e, i) => {
      const x = (2.2 + i * 2.6) * TILE;
      const y = outdoor ? 3.3 * TILE : 2.6 * TILE;
      pos.set(e.name, { x, y, stand: { x, y: y + (outdoor ? 66 : 50) } });
    });
    entries.filter((e) => e.kind !== 'dir').slice(0, 9).forEach((e, i) => {
      const x = (2.3 + i * 1.95) * TILE;
      const y = outdoor ? 8.5 * TILE : 7.7 * TILE;
      pos.set(e.name, { x, y, stand: { x: x - 34, y: y - 8 } });
    });
    return pos;
  }

  class VillageScene extends Phaser.Scene {
    constructor() {
      super('village');
    }

    preload() {
      DS.preload(this);
    }

    create() {
      DS.makeTextures(this);
      this.placeObjs = [];
      this.items = new Map();
      this.known = new Map();
      this.revealed = new Map();
      this.tips = new Set();
      this.queue = Promise.resolve();
      this.cwd = null;
      this.entries = [];
      this.walking = false;
      this.carrying = null;
      this.lastDust = 0;
      this.runes = 0;

      this.heroImg = this.add.image(0, 0, 'hero').setScale(S);
      this.heroC = this.add.container(W / 2, 6.2 * TILE, [
        this.add.ellipse(0, 24, 34, 11, 0x1a1c2c, 0.35),
        this.heroImg,
      ]).setVisible(false);

      this.daemon = this.add.image(W / 2 - 34, 5 * TILE, 'daemon').setScale(S * 0.8).setAlpha(0.95).setDepth(800);
      this.bubble = DS.makeBubble(this, this.daemon);

      this.add.rectangle(0, 0, W, TILE, 0x1a1c2c, 0.92).setOrigin(0).setDepth(900);
      this.placeText = this.add.text(16, TILE / 2, '', { fontFamily: FONT, fontSize: '22px', color: '#ffd447' })
        .setOrigin(0, 0.5).setDepth(901);
      this.cwdText = this.add.text(W - 16, TILE / 2, '', { fontFamily: FONT, fontSize: '18px', color: '#73eff7' })
        .setOrigin(1, 0.5).setDepth(901);
      this.hint = this.add.text(W - 12, H - 10, '', {
        fontFamily: FONT, fontSize: '15px', color: '#f4f4f4', backgroundColor: 'rgba(26,28,44,0.75)', padding: { x: 6, y: 3 },
      }).setOrigin(1, 1).setDepth(905);

      this.createScrollPanel();
      DS.onSceneReady('village', this);
    }

    // ── 메시지 처리 (모두 차례로 큐에서 실행) ───────────────────────────
    onState(st) {
      this.enqueue(() => this.handle(st));
    }

    returnFromRift(st) {
      this.enqueue(async () => {
        const rel = relation(this.cwd, st.cwd);
        this.enterPlace(st, rel.type === 'up' ? { fromChild: rel.child } : 'teleport');
      });
    }

    enqueue(task) {
      this.queue = this.queue.then(task).catch((e) => console.error('village', e));
    }

    onAnnounce(a) {
      this.bubble.say(a.text, Math.max(6000, a.text.length * 160));
    }

    onTyping(data) {
      for (const ch of data) {
        if (ch === '\r') this.cast();
        else if (ch >= ' ' && ch !== '\u007f') this.rune(ch);
      }
    }

    resetAll() {
      this.clearPlace();
      this.known.clear();
      this.revealed.clear();
      this.tips.clear();
      this.queue = Promise.resolve();
      this.cwd = null;
      this.heroC.setVisible(false);
    }

    async handle(st) {
      const rel = relation(this.cwd, st.cwd);
      if (rel.type === 'init') {
        this.enterPlace(st, 'init');
        return;
      }
      if (rel.type === 'same') {
        await this.act(st);
        return;
      }
      if (st.exitCode === 0) this.castRing(0xa7f070);
      if (rel.type === 'down') {
        const item = this.items.get(rel.first);
        if (item) {
          await this.walkTo(item.p.stand.x, item.p.stand.y);
          await this.vanish(0, -26);
        } else {
          await this.teleportOut();
        }
      } else if (rel.type === 'up' && this.exitPoint) {
        await this.walkTo(this.exitPoint.x, this.exitPoint.y);
        await this.vanish(0, 22);
      } else {
        await this.teleportOut();
      }
      if (DS.inRift(st.cwd)) {
        // 균열 안 = 전투 장면
        this.cwd = st.cwd;
        DS.switchScene('battle');
        return;
      }
      this.enterPlace(st, rel.type === 'down' && !rel.deep ? 'fromExit' : rel.type === 'up' ? { fromChild: rel.child } : 'teleport');
    }

    // ── 장소 그리기 ──────────────────────────────────────────────────
    clearPlace() {
      this.placeObjs.forEach((o) => o.destroy());
      this.placeObjs = [];
      this.items.forEach((it) => { it.sprite.destroy(); it.label.destroy(); });
      this.items.clear();
      this.exitPoint = null;
    }

    keep(obj) {
      this.placeObjs.push(obj);
      return obj;
    }

    drawPlace(cwd) {
      this.clearPlace();
      const type = placeType(cwd);
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const h = hash(row * 31 + col * 7 + cwd.length);
          const x = col * TILE + TILE / 2;
          const y = row * TILE + TILE / 2;
          if (type === 'room') {
            const wall = row <= 1 || row === ROWS - 1;
            this.keep(this.add.image(x, y, wall ? 'env2' : 'env', wall ? WALL : ENV.floor).setScale(S).setDepth(0));
          } else {
            let frame = ENV.grass[h % 4];
            if (row === 0 || row === ROWS - 1 || ((col === 0 || col === COLS - 1) && row < 5)) frame = ENV.tree[h % 2];
            else if (row === 6 && col >= 1 && col <= 18) frame = ENV.path;
            else if (h % 13 === 0 && row !== 3 && row !== 2) frame = ENV.flower;
            this.keep(this.add.image(x, y, 'env', frame).setScale(S).setDepth(0));
          }
        }
      }
      if (type === 'wild') this.keep(this.add.rectangle(0, 0, W, H, 0x1a1c2c, 0.35).setOrigin(0).setDepth(1));

      // 출구 (..)
      if (cwd !== '/') {
        if (type === 'room') {
          this.keep(this.add.image(W / 2, 10.1 * TILE, 'door').setScale(S).setDepth(5));
          this.keep(this.labelAt(W / 2, 9.35 * TILE, '.. (나가기)', '#ffd447'));
          this.exitPoint = { x: W / 2, y: 9.2 * TILE };
        } else {
          this.keep(this.add.image(0.95 * TILE, 9.2 * TILE, 'env', ENV.sign).setScale(S).setDepth(5));
          this.keep(this.labelAt(0.95 * TILE, 9.85 * TILE, '..', '#ffd447'));
          this.exitPoint = { x: 1.7 * TILE, y: 9.1 * TILE };
        }
      }
      this.placeText.setText(placeName(cwd));
      this.cwdText.setText(cwd);
    }

    labelAt(x, y, text, color) {
      return this.add.text(x, y, text, {
        fontFamily: FONT, fontSize: '15px', color, backgroundColor: 'rgba(26,28,44,0.72)', padding: { x: 4, y: 1 },
      }).setOrigin(0.5, 0).setDepth(12);
    }

    /** 지금 장소의 물건을 다시 그린다. 새로 보이게 된 것만 튀어나온다. */
    renderItems(st, newlyAdded = new Set()) {
      const type = placeType(st.cwd);
      const known = this.known.get(st.cwd);
      const shown = this.revealed.get(st.cwd);
      const before = new Map([...this.items].map(([name, it]) => [name, it.visible]));
      this.items.forEach((it) => { it.sprite.destroy(); it.label.destroy(); });
      this.items.clear();

      const list = st.entries.filter((e) => !e.hidden || shown.hidden || known.has(e.name));
      const pos = layout(type, list);
      for (const e of list) {
        const p = pos.get(e.name);
        if (!p) continue;
        const visible = shown.basic || known.has(e.name) || (e.hidden && shown.hidden);
        let key;
        let scale = S;
        if (e.kind === 'dir') {
          if (type !== 'room') {
            key = st.cwd === HOME && e.name === 'rift' ? 'rift_0' : HOUSES[hashStr(e.name) % HOUSES.length];
            scale = key.startsWith('rift') ? S * 0.85 : S;
          } else {
            key = 'door';
          }
        } else {
          key = /key/i.test(e.name) ? 'key' : e.hidden ? 'chest' : 'scroll';
        }
        const sprite = this.add.image(p.x, p.y, key).setScale(scale).setDepth(p.y);
        const big = e.kind === 'dir' && type !== 'room';
        const full = e.name + (e.kind === 'dir' ? '/' : '');
        const label = this.labelAt(p.x, p.y + (big ? 50 : 28), visible ? (full.length > 11 ? `${full.slice(0, 10)}…` : full) : '?',
          e.kind === 'dir' ? '#ffd447' : '#f4f4f4');
        if (!visible) sprite.setTint(0x2b2940).setAlpha(0.85);
        else if (e.hidden) this.tweens.add({ targets: sprite, alpha: 0.55, duration: 600, yoyo: true, repeat: -1 });
        if (visible && (before.get(e.name) === false || newlyAdded.has(e.name))) {
          sprite.setScale(0);
          this.tweens.add({ targets: sprite, scale, duration: 280, ease: 'Back.Out' });
          burst(this, p.x, p.y, 0xffd447, 10);
        }
        this.items.set(e.name, { sprite, label, entry: e, p, visible, scale });
      }
      const dark = !shown.basic && st.entries.length > 0;
      const more = st.entries.some((e) => e.hidden) && !shown.hidden;
      this.hint.setText(dark ? '어두워서 잘 안 보인다... (ls)' : more ? '숨은 게 더 있을지도? (ls -a)' : '');
      this.hint.setVisible(this.hint.text.length > 0);
    }

    /** 새 장소에 들어간다. how: init | fromExit | {fromChild} | teleport */
    enterPlace(st, how) {
      const first = !this.revealed.has(st.cwd);
      if (first) {
        this.known.set(st.cwd, new Set());
        this.revealed.set(st.cwd, { basic: false, hidden: false });
      }
      this.cwd = st.cwd;
      this.entries = st.entries;
      this.hideScroll();
      this.drawPlace(st.cwd);
      this.renderItems(st);
      this.cameras.main.fadeIn(220, 26, 28, 44);

      const type = placeType(st.cwd);
      const home = { x: W / 2, y: type === 'room' ? 5.4 * TILE : 6.2 * TILE };
      let start = home;
      if (how === 'fromExit' && this.exitPoint) start = this.exitPoint;
      if (how && how.fromChild) {
        const child = this.items.get(how.fromChild);
        if (child) start = child.p.stand;
      }
      this.heroC.setPosition(start.x, start.y).setVisible(true);
      this.heroImg.setAlpha(0).setScale(S * 0.6);
      this.tweens.add({ targets: this.heroImg, alpha: 1, scale: S, duration: 240 });
      if (how === 'teleport') burst(this, start.x, start.y, 0x73eff7, 18);
      if (start !== home) this.time.delayedCall(260, () => this.walkTo(home.x, home.y));

      this.tip(st, first);
    }

    // ── 같은 장소에서의 명령 ─────────────────────────────────────────
    async act(st) {
      const { word, args, flags } = parseCommand(st.command);
      const known = this.known.get(st.cwd);
      const shown = this.revealed.get(st.cwd);
      const oldNames = new Set(this.entries.map((e) => e.name));
      const newNames = new Set(st.entries.map((e) => e.name));
      const added = st.entries.filter((e) => !oldNames.has(e.name));
      const removed = this.entries.filter((e) => !newNames.has(e.name));
      added.forEach((e) => known.add(e.name)); // 직접 만든 것은 이미 안다

      if (!st.newCommand || !st.command) {
        this.entries = st.entries;
        this.renderItems(st);
        return;
      }
      if (st.exitCode !== 0) {
        this.heroFail(st.exitCode);
        this.entries = st.entries;
        this.renderItems(st);
        return;
      }

      if (!/^(cat|less|more|head|tail)$/.test(word)) this.hideScroll();
      const target = (name) => this.items.get(basename(name || ''));
      const newPos = layout(placeType(st.cwd), st.entries.filter((e) => !e.hidden || shown.hidden || known.has(e.name)));

      if (/^(ls|ll|la|l|dir|tree)$/.test(word)) {
        shown.basic = true;
        if (/a|A/.test(flags) || word === 'll' || word === 'la') shown.hidden = true;
        await this.torch();
      } else if (word === 'find') {
        shown.basic = true;
        shown.hidden = true;
        await this.radar();
      } else if (/^(cat|less|more|head|tail)$/.test(word)) {
        const t = target(args[0]);
        if (t) await this.walkTo(t.p.stand.x, t.p.stand.y);
        this.showScroll(args[0] || word, st.output || []);
      } else if (word === 'pwd') {
        this.showSign(st.cwd);
      } else if ((word === 'rm' || word === 'rmdir') && removed.length) {
        for (const e of removed) {
          const it = this.items.get(e.name);
          if (!it) continue;
          await this.walkTo(it.p.stand.x, it.p.stand.y);
          await this.smash(it);
        }
      } else if (word === 'mv' && removed.length) {
        const it = this.items.get(removed[0].name);
        const dest = added[0] ? newPos.get(added[0].name) : target(args[args.length - 1])?.p;
        if (it && dest) {
          await this.walkTo(it.p.stand.x, it.p.stand.y);
          this.pickUp(it);
          await this.walkTo(dest.stand.x, dest.stand.y);
          await this.drop(dest);
        }
      } else if (word === 'cp' && added.length) {
        const src = target(args[0]);
        if (src) {
          await this.walkTo(src.p.stand.x, src.p.stand.y);
          burst(this, src.p.x, src.p.y, 0x73eff7, 14);
          floatText(this, src.p.x, src.p.y - 30, '복제!', '#73eff7', 20);
        }
      } else if (word === 'touch' && added.length) {
        const p = newPos.get(added[0].name);
        if (p) await this.walkTo(p.stand.x, p.stand.y);
        this.tweens.add({ targets: this.heroImg, scaleY: S * 0.8, duration: 100, yoyo: true });
      } else if (word === 'mkdir' && added.length) {
        const p = newPos.get(added[0].name);
        if (p) {
          await this.walkTo(p.stand.x, p.stand.y);
          for (let i = 0; i < 3; i++) {
            this.time.delayedCall(i * 160, () => {
              floatText(this, p.x + (i - 1) * 24, p.y, '쾅!', '#ffd447', 20);
              burst(this, p.x, p.y + 30, 0xc9b28a, 10);
            });
          }
          await this.wait(500);
        }
      } else if (removed.length) {
        removed.forEach((e) => { const it = this.items.get(e.name); if (it) burst(this, it.p.x, it.p.y, 0xead39f, 12); });
      }

      this.castRing(0xa7f070);
      this.entries = st.entries;
      this.renderItems(st, new Set(added.map((e) => e.name)));
      this.tip(st, false, word, args);
    }

    // ── 주인공 동작 ──────────────────────────────────────────────────
    wait(ms) {
      return new Promise((resolve) => this.time.delayedCall(ms, resolve));
    }

    walkTo(x, y) {
      return new Promise((resolve) => {
        const ty = Phaser.Math.Clamp(y, TILE * 1.3, H - TILE * 0.6);
        const dist = Phaser.Math.Distance.Between(this.heroC.x, this.heroC.y, x, ty);
        if (dist < 4) { resolve(); return; }
        this.heroImg.setFlipX(x < this.heroC.x);
        this.walking = true;
        this.tweens.add({
          targets: this.heroC, x, y: ty, duration: (dist / WALK_SPEED) * 1000, ease: 'Linear',
          onComplete: () => { this.walking = false; resolve(); },
        });
      });
    }

    vanish(dx, dy) {
      return new Promise((resolve) => {
        this.tweens.add({
          targets: this.heroImg, alpha: 0, scale: S * 0.6, x: dx, y: dy, duration: 240,
          onComplete: () => { this.heroImg.setPosition(0, 0); resolve(); },
        });
      });
    }

    async teleportOut() {
      burst(this, this.heroC.x, this.heroC.y, 0x73eff7, 18);
      floatText(this, this.heroC.x, this.heroC.y - 40, '순간이동!', '#73eff7', 20);
      await this.vanish(0, -10);
    }

    async torch() {
      this.tweens.add({ targets: this.heroImg, y: -8, duration: 120, yoyo: true });
      const light = this.add.circle(this.heroC.x, this.heroC.y, 20, 0xffd447, 0.35).setDepth(2);
      this.tweens.add({ targets: light, scale: 40, alpha: 0, duration: 700, ease: 'Quad.Out', onComplete: () => light.destroy() });
      floatText(this, this.heroC.x, this.heroC.y - 50, '횃불!', '#ffd447', 20);
      await this.wait(250);
    }

    async radar() {
      for (let i = 0; i < 3; i++) {
        const ring = this.add.circle(this.heroC.x, this.heroC.y, 16).setStrokeStyle(4, 0x73eff7, 0.9).setDepth(1040);
        this.tweens.add({ targets: ring, scale: 30, alpha: 0, delay: i * 180, duration: 900, onComplete: () => ring.destroy() });
      }
      await this.wait(400);
    }

    async smash(it) {
      const sword = this.add.image(this.heroC.x + 14, this.heroC.y - 10, 'sword').setScale(S).setOrigin(0.5, 0.9).setAngle(-70).setDepth(1050);
      await new Promise((resolve) => this.tweens.add({ targets: sword, angle: 80, duration: 140, ease: 'Quad.In', onComplete: resolve }));
      sword.destroy();
      this.cameras.main.shake(120, 0.006);
      it.sprite.setTint(0xff3030);
      floatText(this, it.p.x, it.p.y - 30, '쨍그랑!', '#ff6b6b', 22);
      burst(this, it.p.x, it.p.y, 0xead39f, 22);
      burst(this, it.p.x, it.p.y, 0xffffff, 8);
      it.sprite.setVisible(false);
      it.label.setVisible(false);
      await this.wait(150);
    }

    pickUp(it) {
      this.carrying = it.sprite;
      it.label.setVisible(false);
      it.sprite.setDepth(2000).setScale(it.scale * 0.8);
      floatText(this, this.heroC.x, this.heroC.y - 60, '영차!', '#f4f4f4', 18);
    }

    async drop(dest) {
      const sprite = this.carrying;
      this.carrying = null;
      if (!sprite) return;
      await new Promise((resolve) => this.tweens.add({ targets: sprite, x: dest.x, y: dest.y, alpha: 0.2, duration: 220, onComplete: resolve }));
      burst(this, dest.x, dest.y, 0xffd447, 10);
    }

    castRing(color) {
      const ring = this.add.ellipse(this.heroC.x, this.heroC.y + 22, 40, 14).setStrokeStyle(3, color, 1).setDepth(5);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    }

    cast() {
      if (!this.heroC.visible) return;
      const ring = this.add.circle(this.heroC.x, this.heroC.y + 18, 10).setStrokeStyle(3, 0xffd447, 1).setDepth(5);
      this.tweens.add({ targets: ring, scaleX: 4, scaleY: 1.6, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
    }

    rune(ch) {
      if (this.runes > 40 || !this.heroC.visible) return;
      this.runes++;
      const t = this.add.text(this.heroC.x + Phaser.Math.Between(-14, 14), this.heroC.y - 34, ch === ' ' ? '·' : ch, {
        fontFamily: FONT, fontSize: '22px', color: Phaser.Utils.Array.GetRandom(RUNE_COLORS), stroke: '#1a1c2c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(1060);
      this.tweens.add({
        targets: t, y: t.y - Phaser.Math.Between(36, 64), x: t.x + Phaser.Math.Between(-18, 18),
        angle: Phaser.Math.Between(-25, 25), alpha: 0, duration: 750, ease: 'Quad.Out',
        onComplete: () => { t.destroy(); this.runes--; },
      });
    }

    heroFail(code) {
      this.heroImg.setTint(0xff8080);
      this.time.delayedCall(260, () => this.heroImg.clearTint());
      this.tweens.add({ targets: this.heroImg, x: 5, duration: 45, yoyo: true, repeat: 3 });
      floatText(this, this.heroC.x + 26, this.heroC.y - 46, '!', '#ff6b6b', 34);
      this.bubble.say(`앗, 실패했어! (종료 코드 ${code}) 터미널의 에러 메시지를 읽어 봐.`, 3500);
    }

    // ── 양피지 (cat 내용) · 표지판 (pwd) ─────────────────────────────
    createScrollPanel() {
      this.scroll = this.add.container(W / 2, TILE + 12).setDepth(1080).setVisible(false);
      this.scrollBg = this.add.graphics();
      this.scrollTitle = this.add.text(0, 12, '', { fontFamily: FONT, fontSize: '18px', color: '#3b2a1a' }).setOrigin(0.5, 0);
      this.scrollBody = this.add.text(-300, 42, '', { fontFamily: FONT, fontSize: '16px', color: '#3b2a1a', lineSpacing: 5 });
      this.scroll.add([this.scrollBg, this.scrollTitle, this.scrollBody]);
    }

    showScroll(title, lines) {
      const body = lines.filter((l) => l.trim().length).slice(0, 9).map((l) => (l.length > 56 ? `${l.slice(0, 55)}…` : l));
      this.scrollTitle.setText(`📜 ${title}`);
      this.scrollBody.setText(body.length ? body.join('\n') : '(아무것도 적혀 있지 않다)');
      const w = 640;
      const h = this.scrollBody.height + 60;
      const g = this.scrollBg;
      g.clear();
      g.fillStyle(0xf4e4c1, 0.98);
      g.fillRect(-w / 2, 0, w, h);
      g.lineStyle(4, 0x3b2a1a, 1);
      g.strokeRect(-w / 2, 0, w, h);
      g.fillStyle(0xd9b98a, 1);
      g.fillRect(-w / 2 - 8, -6, w + 16, 12);
      g.fillRect(-w / 2 - 8, h - 6, w + 16, 12);
      this.scroll.setVisible(true).setAlpha(0).setScale(1, 0.2);
      this.tweens.killTweensOf(this.scroll);
      this.tweens.add({ targets: this.scroll, alpha: 1, scaleY: 1, duration: 220, ease: 'Back.Out' });
      this.tweens.add({ targets: this.scroll, alpha: 0, delay: 8000, duration: 300 });
    }

    hideScroll() {
      if (!this.scroll.visible) return;
      this.tweens.killTweensOf(this.scroll);
      this.tweens.add({ targets: this.scroll, alpha: 0, duration: 150, onComplete: () => this.scroll.setVisible(false) });
    }

    showSign(cwd) {
      const t = this.add.text(this.heroC.x, this.heroC.y - 70, `📍 ${cwd}`, {
        fontFamily: FONT, fontSize: '20px', color: '#1a1c2c', backgroundColor: '#ffd447', padding: { x: 8, y: 4 },
      }).setOrigin(0.5).setDepth(1080);
      this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, delay: 2500, duration: 400, onComplete: () => t.destroy() });
    }

    // ── 데몬의 길잡이 ────────────────────────────────────────────────
    tip(st, firstVisit, word, args) {
      const say = (key, text) => {
        if (this.tips.has(key)) return;
        this.tips.add(key);
        this.bubble.say(text, 7000);
      };
      const shown = this.revealed.get(st.cwd);
      if (st.cwd === HOME && !shown.basic) say('home-dark', '여기는 마을 광장이야! 어두워서 잘 안 보이네. ls 로 둘러보자.');
      else if (st.cwd === HOME && word && /^l/.test(word)) say('home-lit', '건물 하나하나가 디렉터리야. cat welcome.txt 로 게시판부터 읽어 봐!');
      else if (word === 'cat' && args && args[0] === 'welcome.txt') say('read-welcome', '도서관에 가 보자! cd library');
      else if (st.cwd === `${HOME}/library` && firstVisit) say('library', '여긴 도서관이야. ls 로 책장을 보고, cat cd.txt 처럼 읽어 봐. 다 읽으면 cd .. 로 나가자.');
      else if (st.cwd === HOME && this.tips.has('library')) say('go-rift', '준비됐으면 cd rift 로 균열에 들어가 버그를 막자! (F1 주문서 참고)');
      else if (firstVisit && !shown.basic && st.entries.length) say(`dark:${st.cwd}`, '처음 와 보는 곳이야. ls 로 밝혀 보자.');
    }

    // ── 매 프레임 ───────────────────────────────────────────────────
    update(time) {
      if (this.walking) {
        this.heroImg.angle = Math.sin(time / 55) * 8;
        this.heroImg.y = -Math.abs(Math.sin(time / 80)) * 6;
        if (time - this.lastDust > 140) {
          this.lastDust = time;
          const d = this.add.circle(this.heroC.x + Phaser.Math.Between(-6, 6), this.heroC.y + 22, 4, 0xd9cfa8, 0.8).setDepth(4);
          this.tweens.add({ targets: d, scale: 2, alpha: 0, y: d.y - 6, duration: 350, onComplete: () => d.destroy() });
        }
      } else if (this.heroImg.alpha === 1) {
        this.heroImg.angle = 0;
        this.heroImg.y = Math.sin(time / 500) * 2;
      }
      this.heroC.setDepth(this.heroC.y + 1);
      if (this.carrying) this.carrying.setPosition(this.heroC.x, this.heroC.y - 48);

      const tx = this.heroC.x - 36;
      const ty = this.heroC.y - 66 + Math.sin(time / 400) * 5;
      this.daemon.x += (tx - this.daemon.x) * 0.08;
      this.daemon.y += (ty - this.daemon.y) * 0.08;
      this.bubble.follow();

      const frame = Math.floor(time / 140) % 3;
      this.items.forEach((it) => { if (it.sprite.texture.key.startsWith('rift')) it.sprite.setTexture(`rift_${frame}`); });
    }
  }

  DS.VillageScene = VillageScene;
})();
