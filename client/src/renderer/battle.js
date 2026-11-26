// 전투 장면: 균열(~/rift) 안. 몬스터 = 컨테이너의 진짜 프로세스.
//   onStage   스테이지 정보
//   onWorld   0.5초마다 전장 상태 (HP, 페이즈, 몬스터)
//   onState   명령이 끝날 때마다 (ps 정찰, pstree 가족선, 성공·실패 연출)
//   onTyping  영창 룬
//   onAnnounce 데몬 대사
//   onResult  승패
(function () {
  'use strict';
  const { S, TILE, COLS, ROWS, W, H, FONT, hash, burst, floatText } = DS;

  const LANE_Y = 7.5 * TILE;
  const GATE = { x: W - 1.15 * TILE, y: LANE_Y - 18 };
  const CORE = { x: 1.4 * TILE, y: LANE_Y - 8 };
  const STOP_X = CORE.x + 1.15 * TILE;
  const HERO = { x: 3.3 * TILE, y: 6.35 * TILE };

  const ENV = { grass: [0, 17, 34, 51], flower: 68, tree: [13, 14], lane: 87 };
  const KINDS = {
    bug: { frames: ['bug_0', 'bug_1'], scale: S, color: 0x8ee65a, label: '#a7f070' },
    'bug-queen': { frames: ['queen_0', 'queen_1'], scale: S * 1.5, color: 0xef7fdc, label: '#ffb3f0' },
  };
  const RUNE_COLORS = ['#73eff7', '#ffd447', '#ef7fdc', '#a7f070', '#ffffff'];

  class BattleScene extends Phaser.Scene {
    constructor() {
      super('battle');
    }

    create() {
      DS.makeTextures(this);
      this.drawMap();
      this.createActors();
      this.createHud();
      this.familyGfx = this.add.graphics().setDepth(450);

      this.stage = null;
      this.phase = null;
      this.wave = 0;
      this.prevHp = null;
      this.monsters = new Map();
      this.familyUntil = 0;
      this.combo = 0;
      this.lastKillAt = 0;
      this.lastShakeAt = 0;
      this.nextThrowAt = 0;
      this.runes = 0;
      DS.onSceneReady('battle', this);
    }

    // ── 준비 ─────────────────────────────────────────────────────────
    tile(frame, col, row) {
      return this.add.image(col * TILE + TILE / 2, row * TILE + TILE / 2, 'env', frame).setScale(S);
    }

    drawMap() {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const h = hash(row * 31 + col * 7);
          let frame = ENV.grass[h % 4];
          if (row <= 1 || row === ROWS - 1) frame = ENV.tree[h % 2];
          else if (row === 7 && col >= 2 && col <= 18) frame = ENV.lane;
          else if (h % 11 === 0) frame = ENV.flower;
          this.tile(frame, col, row).setDepth(0);
        }
      }
      // 몬스터가 쏟아져 나오는 균열 문
      this.gateAura = this.add.ellipse(GATE.x, GATE.y, 170, 190, 0xff4dd2, 0.16).setDepth(1);
      this.tweens.add({ targets: this.gateAura, scale: 1.12, alpha: 0.3, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.gateGlow = this.add.ellipse(GATE.x, GATE.y, 120, 140, 0xff3b3b, 0).setDepth(1);
      this.add.ellipse(GATE.x, GATE.y + 56, 120, 26, 0x1a1c2c, 0.45).setDepth(1);
      this.gate = this.add.image(GATE.x, GATE.y, 'rift_0').setScale(S).setDepth(2);
      this.add.text(GATE.x, GATE.y - 70, '균열', {
        fontFamily: FONT, fontSize: '16px', color: '#ffb3f0', stroke: '#1a1c2c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(3);
      this.time.addEvent({
        delay: 140, loop: true, callback: () => {
          const a = Math.random() * Math.PI * 2;
          const r = 70 + Math.random() * 40;
          const p = this.add.image(GATE.x + Math.cos(a) * r, GATE.y + Math.sin(a) * r * 1.1, 'px')
            .setTint(Math.random() < 0.5 ? 0xff4dd2 : 0x8a2fc9).setScale(1 + Math.random()).setDepth(3);
          this.tweens.add({ targets: p, x: GATE.x, y: GATE.y + 10, scale: 0.2, alpha: 0.2, duration: 700, ease: 'Quad.In', onComplete: () => p.destroy() });
        },
      });
    }

    shadow(x, y, w) {
      return this.add.ellipse(x, y, w, w * 0.32, 0x1a1c2c, 0.35);
    }

    createActors() {
      this.coreGlow = this.add.ellipse(CORE.x, CORE.y + 4, 92, 92, 0x7ff3f0, 0.18).setDepth(3);
      this.tweens.add({ targets: this.coreGlow, scale: 1.18, alpha: 0.32, duration: 900, yoyo: true, repeat: -1 });
      this.shadow(CORE.x, CORE.y + 34, 52).setDepth(3);
      this.core = this.add.image(CORE.x, CORE.y, 'core').setScale(S * 1.4).setDepth(CORE.y);

      this.shadow(HERO.x, HERO.y + 24, 34).setDepth(4);
      this.hero = this.add.image(HERO.x, HERO.y, 'hero').setScale(S).setDepth(HERO.y);
      this.tweens.add({ targets: this.hero, y: HERO.y - 3, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

      this.daemon = this.add.image(HERO.x - 34, HERO.y - 62, 'daemon').setScale(S * 0.8).setAlpha(0.95).setDepth(800);
      this.tweens.add({ targets: this.daemon, y: HERO.y - 70, x: HERO.x - 30, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.bubble = DS.makeBubble(this, this.daemon);
    }

    createHud() {
      this.add.rectangle(0, 0, W, TILE, 0x1a1c2c, 0.92).setOrigin(0).setDepth(900);
      this.hearts = [];
      for (let i = 0; i < 5; i++) {
        this.hearts.push(this.add.image(26 + i * 38, TILE / 2, 'heart_full').setScale(2).setDepth(901));
      }
      this.titleText = this.add.text(222, TILE / 2, '', { fontFamily: FONT, fontSize: '22px', color: '#ffd447' })
        .setOrigin(0, 0.5).setDepth(901);
      this.waveText = this.add.text(W - 16, TILE / 2, '', { fontFamily: FONT, fontSize: '22px', color: '#f4f4f4' })
        .setOrigin(1, 0.5).setDepth(901);
      this.banner = this.add.text(W / 2, H * 0.42, '', {
        fontFamily: FONT, fontSize: '56px', color: '#ffd447', stroke: '#1a1c2c', strokeThickness: 10, align: 'center',
      }).setOrigin(0.5).setDepth(1100).setAlpha(0);
      this.comboText = this.add.text(W / 2, H * 0.62, '', {
        fontFamily: FONT, fontSize: '30px', color: '#ff9f43', stroke: '#1a1c2c', strokeThickness: 8,
      }).setOrigin(0.5).setDepth(1100).setAlpha(0);
    }

    // ── 메시지 처리 ─────────────────────────────────────────────────
    resetAll() {
      this.monsters.forEach((m) => this.removeMonster(m, false));
      this.monsters.clear();
      this.phase = null;
      this.prevHp = null;
      this.core.clearTint().setAlpha(1);
    }

    onStage(stage) {
      this.resetAll();
      this.stage = stage;
      this.titleText.setText(`${stage.id} ${stage.title}`);
    }

    onWorld(w) {
      const now = this.time.now;
      if (w.phase !== this.phase || w.wave !== this.wave) this.onPhaseChange(w);
      this.phase = w.phase;
      this.wave = w.wave;

      this.updateHearts(w.hp, w.maxHp);
      if (this.prevHp !== null && w.hp < this.prevHp - 0.01) this.onCoreHit();
      this.prevHp = w.hp;

      if (w.phase === 'intro') this.waveText.setText(`준비 ${Math.ceil(w.phaseRemainingMs / 1000)}초`);
      else if (w.phase === 'break') this.waveText.setText(`다음 웨이브 ${Math.ceil(w.phaseRemainingMs / 1000)}초`);
      else this.waveText.setText(`WAVE ${w.wave}/${w.waveTotal}  처치 ${w.kills}`);

      const seen = new Set();
      for (const view of w.monsters) {
        seen.add(view.pid);
        let m = this.monsters.get(view.pid);
        if (!m) {
          m = this.addMonster(view);
          this.monsters.set(view.pid, m);
        }
        m.progress = view.progress;
        m.speed = view.speed;
        m.recvAt = now;
        m.ppid = view.ppid;
      }
      for (const [pid, m] of this.monsters) {
        if (!seen.has(pid)) {
          this.monsters.delete(pid);
          this.removeMonster(m, w.phase === 'wave' || w.phase === 'break');
        }
      }
    }

    onPhaseChange(w) {
      if (w.phase === 'intro' && this.stage) {
        this.showBanner(`${this.stage.id} ${this.stage.title}`, '#ffd447');
      } else if (w.phase === 'wave') {
        this.showBanner(`WAVE ${w.wave}`, '#ff6b6b');
        this.cameras.main.flash(220, 255, 60, 120);
        this.cameras.main.shake(380, 0.008);
        this.gateGlow.setAlpha(0.55);
        this.tweens.add({ targets: this.gateGlow, alpha: 0.12, duration: 600, yoyo: true, repeat: 4 });
        this.tweens.add({ targets: this.gate, x: GATE.x + 5, duration: 45, yoyo: true, repeat: 12 });
        this.tweens.add({ targets: this.gate, scale: S * 1.12, duration: 160, yoyo: true, ease: 'Quad.Out' });
        burst(this, GATE.x, GATE.y, 0xff4dd2, 36);
        burst(this, GATE.x, GATE.y, 0xff3b3b, 20);
        floatText(this, GATE.x - 30, GATE.y - 90, '균열이 열린다!', '#ff6b6b', 22);
      } else if (w.phase === 'break') {
        const wait = Math.max(0, this.nextThrowAt - this.time.now) + 700;
        this.time.delayedCall(wait, () => this.showBanner('웨이브 클리어!', '#a7f070'));
      }
    }

    onAnnounce(a) {
      this.bubble.say(a.text, Math.max(7000, a.text.length * 170));
    }

    onResult(r) {
      if (r.outcome === 'victory') {
        this.showBanner('승리!', '#ffd447', 2600);
        for (let i = 0; i < 5; i++) {
          this.time.delayedCall(i * 180, () => burst(this,
            Phaser.Math.Between(TILE * 3, W - TILE * 3), Phaser.Math.Between(TILE * 2, H - TILE * 3),
            [0xffd447, 0x73eff7, 0xef7fdc, 0xa7f070][i % 4], 28));
        }
      } else {
        this.showBanner('서버 다운...', '#ff6b6b', 2600);
        burst(this, CORE.x, CORE.y, 0x7ff3f0, 40);
        this.core.setTint(0x555566).setAlpha(0.6);
        this.cameras.main.shake(400, 0.012);
      }
    }

    onState(st) {
      const command = (st.command || '').trim();
      if (!st.newCommand || !command) return;
      const { word } = DS.parseCommand(command);
      if (st.exitCode !== 0) this.heroFail(st.exitCode);
      else this.heroSuccess();

      const pipes = (command.match(/\|/g) || []).length;
      if (pipes > 0) floatText(this, HERO.x, HERO.y - 70, `파이프 연계 x${pipes + 1}!`, '#ff9f43', 24);
      if (/^(ps|top|htop|pgrep)$/.test(word)) {
        this.scan();
        if (/--forest|-e?f\b|\bf\b|axjf|ppid/.test(command)) this.familyUntil = this.time.now + 15000;
      } else if (word === 'pstree') {
        this.scan();
        this.familyUntil = this.time.now + 15000;
      }
    }

    onTyping(data) {
      for (const ch of data) {
        if (ch === '\r') this.cast();
        else if (ch >= ' ' && ch !== '\u007f') this.rune(ch);
      }
    }

    // ── 몬스터 ──────────────────────────────────────────────────────
    addMonster(view) {
      const kind = KINDS[view.kind] || KINDS.bug;
      const parent = this.monsters.get(view.ppid);
      const jitter = ((hash(view.pid) % 40) - 20) * (view.kind === 'bug-queen' ? 0.3 : 1);
      const m = {
        pid: view.pid, ppid: view.ppid, kind: view.kind, def: kind, jitter,
        progress: view.progress, speed: view.speed, recvAt: this.time.now, frame: 0,
      };
      const { x, y } = parent ? this.monsterPos(parent) : this.monsterPos(m);
      m.shadow = this.shadow(x, y + 20, 30 * (kind.scale / S)).setDepth(4);
      m.sprite = this.add.image(x, y, kind.frames[0]).setScale(0).setDepth(y);
      m.label = this.add.text(x, y - 34, '?', {
        fontFamily: FONT, fontSize: '16px', color: kind.label, stroke: '#1a1c2c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(700);
      this.tweens.add({ targets: m.sprite, scale: kind.scale, duration: 260, ease: 'Back.Out' });
      burst(this, x, y, kind.color, 8);
      return m;
    }

    monsterPos(m) {
      const p = Phaser.Math.Clamp(m.progress + (m.speed * (this.time.now - m.recvAt)) / 1000, 0, 1);
      let x = GATE.x + (STOP_X - GATE.x) * p;
      const y = LANE_Y + m.jitter - (m.kind === 'bug-queen' ? 10 : 0);
      if (p >= 1) x += Math.sin(this.time.now / 70 + m.pid) * 5;
      return { x, y, p };
    }

    removeMonster(m, killed) {
      const cleanup = () => { m.sprite.destroy(); m.label.destroy(); m.shadow.destroy(); };
      if (!killed) {
        this.tweens.add({ targets: [m.sprite, m.label, m.shadow], alpha: 0, duration: 250, onComplete: cleanup });
        return;
      }
      // 프로세스는 이미 죽었다. 몬스터는 그 자리에 멈춰 떨고, 주인공이 무기를 던져 마무리한다.
      this.tweens.add({ targets: m.sprite, x: m.sprite.x + 2, duration: 40, yoyo: true, repeat: 3 });
      const now = this.time.now;
      this.nextThrowAt = Math.max(now, this.nextThrowAt) + 85;
      this.time.delayedCall(this.nextThrowAt - now - 85, () => this.throwWeapon(m, cleanup));
    }

    /** 투척 → 명중(경직·넉백·번쩍) → 격파 */
    throwWeapon(m, cleanup) {
      const big = m.kind === 'bug-queen';
      this.tweens.add({ targets: this.hero, x: HERO.x - 6, duration: 60, yoyo: true,
        onYoyo: () => this.tweens.add({ targets: this.hero, x: HERO.x + 10, duration: 70, yoyo: true }) });
      const from = { x: HERO.x + 16, y: HERO.y - 10 };
      const weapon = this.add.image(from.x, from.y, big ? 'sword' : 'dagger').setScale(big ? S * 1.5 : S).setDepth(1050);
      const dist = Math.abs(m.sprite.x - from.x);
      const arc = Math.min(90, 30 + dist * 0.12);
      let lastTrail = 0;
      this.tweens.addCounter({
        from: 0, to: 1, duration: Phaser.Math.Clamp(dist * 0.42, 160, 420), ease: 'Linear',
        onUpdate: (tween) => {
          const t = tween.getValue();
          weapon.x = from.x + (m.sprite.x - from.x) * t;
          weapon.y = from.y + (m.sprite.y - from.y) * t - Math.sin(t * Math.PI) * arc;
          weapon.angle += big ? 22 : 34;
          if (this.time.now - lastTrail > 30) {
            lastTrail = this.time.now;
            const ghost = this.add.image(weapon.x, weapon.y, weapon.texture.key)
              .setScale(weapon.scale).setAngle(weapon.angle).setAlpha(0.35).setDepth(1049);
            this.tweens.add({ targets: ghost, alpha: 0, duration: 160, onComplete: () => ghost.destroy() });
          }
        },
        onComplete: () => this.onHit(m, weapon, big, cleanup),
      });
    }

    onHit(m, weapon, big, cleanup) {
      const { x, y } = m.sprite;
      this.tweens.add({ targets: weapon, x: x - 24, y: y + 26, angle: weapon.angle + 200, alpha: 0, duration: 380, ease: 'Quad.Out', onComplete: () => weapon.destroy() });
      m.sprite.setTint(0xff3030);
      m.sprite.setScale(m.def.scale * 1.25, m.def.scale * 0.8);
      this.tweens.add({ targets: m.sprite, x: x + (big ? 14 : 22), duration: 90, ease: 'Quad.Out' });
      const spark = this.add.star(x - 6, y - 4, 6, 6, 18, 0xffffff).setDepth(1055);
      this.tweens.add({ targets: spark, scale: 2, alpha: 0, angle: 45, duration: 160, onComplete: () => spark.destroy() });
      floatText(this, x, y - 34, big ? 'CRITICAL!' : 'HIT!', big ? '#ff6b6b' : '#ffd447', big ? 28 : 22);
      this.cameras.main.shake(big ? 260 : 90, big ? 0.012 : 0.005);
      this.time.delayedCall(big ? 160 : 90, () => {
        const px = m.sprite.x;
        const py = m.sprite.y;
        cleanup();
        burst(this, px, py, m.def.color, big ? 48 : 20);
        burst(this, px, py, 0xffffff, big ? 16 : 6);
        const skull = this.add.image(px, py, 'skull').setScale(S * 0.8).setDepth(1060);
        this.tweens.add({ targets: skull, y: py - 46, alpha: 0, duration: 700, ease: 'Quad.Out', onComplete: () => skull.destroy() });
        floatText(this, px, py - 8, `PID ${m.pid} 종료`, '#ffffff', 18);
        if (big) this.cameras.main.flash(160, 255, 220, 255);
        this.addCombo();
      });
    }

    addCombo() {
      const now = this.time.now;
      this.combo = now - this.lastKillAt < 2500 ? this.combo + 1 : 1;
      this.lastKillAt = now;
      if (this.combo >= 2) {
        this.comboText.setText(`COMBO x${this.combo}`).setAlpha(1).setScale(1.4);
        this.tweens.killTweensOf(this.comboText);
        this.tweens.add({ targets: this.comboText, scale: 1, duration: 160, ease: 'Back.Out' });
        this.tweens.add({ targets: this.comboText, alpha: 0, delay: 1200, duration: 400 });
      }
    }

    scan() {
      const ring = this.add.circle(HERO.x, HERO.y, 20).setStrokeStyle(4, 0x73eff7, 0.9).setDepth(1040);
      this.tweens.add({ targets: ring, scale: 26, alpha: 0, duration: 900, ease: 'Quad.Out', onComplete: () => ring.destroy() });
      this.monsters.forEach((m) => {
        m.label.setText(`PID ${m.pid}`);
        this.tweens.add({ targets: m.label, scale: 1.3, duration: 120, yoyo: true });
      });
    }

    onCoreHit() {
      this.core.setTint(0xff7777);
      this.time.delayedCall(120, () => { if (this.phase !== 'defeat') this.core.clearTint(); });
      this.hearts.forEach((h) => this.tweens.add({ targets: h, y: TILE / 2 - 3, duration: 60, yoyo: true }));
      if (this.time.now - this.lastShakeAt > 900) {
        this.cameras.main.shake(140, 0.003);
        this.lastShakeAt = this.time.now;
        burst(this, CORE.x + 20, CORE.y, 0xff5d6c, 6);
      }
    }

    updateHearts(hp, maxHp) {
      const per = maxHp / this.hearts.length;
      this.hearts.forEach((h, i) => {
        const v = hp - i * per;
        h.setTexture(v >= per * 0.75 ? 'heart_full' : v >= per * 0.25 ? 'heart_half' : 'heart_empty');
      });
    }

    // ── 주인공 연출 ──────────────────────────────────────────────────
    rune(ch) {
      if (this.runes > 40) return;
      this.runes++;
      const t = this.add.text(HERO.x + Phaser.Math.Between(-14, 14), HERO.y - 34, ch === ' ' ? '·' : ch, {
        fontFamily: FONT, fontSize: '22px', color: Phaser.Utils.Array.GetRandom(RUNE_COLORS),
        stroke: '#1a1c2c', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(1060);
      this.tweens.add({
        targets: t, y: t.y - Phaser.Math.Between(36, 64), x: t.x + Phaser.Math.Between(-18, 18),
        angle: Phaser.Math.Between(-25, 25), alpha: 0, duration: 750, ease: 'Quad.Out',
        onComplete: () => { t.destroy(); this.runes--; },
      });
    }

    cast() {
      const ring = this.add.circle(HERO.x, HERO.y + 18, 10).setStrokeStyle(3, 0xffd447, 1).setDepth(5);
      this.tweens.add({ targets: ring, scaleX: 4, scaleY: 1.6, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
      this.tweens.add({ targets: this.hero, scale: S * 1.12, duration: 90, yoyo: true });
    }

    heroSuccess() {
      const ring = this.add.ellipse(HERO.x, HERO.y + 22, 40, 14).setStrokeStyle(3, 0xa7f070, 1).setDepth(5);
      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
    }

    heroFail(code) {
      this.hero.setTint(0xff8080);
      this.time.delayedCall(260, () => this.hero.clearTint());
      this.tweens.add({ targets: this.hero, x: HERO.x + 5, duration: 45, yoyo: true, repeat: 3 });
      floatText(this, HERO.x + 26, HERO.y - 46, '!', '#ff6b6b', 34);
      this.bubble.say(`앗, 실패했어! (종료 코드 ${code}) 터미널의 에러 메시지를 읽어 봐.`, 3200);
    }

    showBanner(text, color, hold = 1400) {
      this.tweens.killTweensOf(this.banner);
      this.banner.setText(text).setColor(color).setAlpha(1).setScale(0.4);
      this.tweens.add({ targets: this.banner, scale: 1, duration: 260, ease: 'Back.Out' });
      this.tweens.add({ targets: this.banner, alpha: 0, delay: hold, duration: 400 });
    }

    // ── 매 프레임 ───────────────────────────────────────────────────
    update(time) {
      this.gate.setTexture(`rift_${Math.floor(time / 140) % 3}`);
      this.bubble.follow();
      this.familyGfx.clear();
      const showFamily = time < this.familyUntil;
      for (const m of this.monsters.values()) {
        const { x, y } = this.monsterPos(m);
        m.sprite.setPosition(x, y).setDepth(y);
        m.shadow.setPosition(x, y + 20 * (m.def.scale / S));
        m.label.setPosition(x, y - 18 - 8 * m.def.scale - (hash(m.pid) % 3) * 14);
        const frame = Math.floor(time / 220 + m.pid) % 2;
        if (frame !== m.frame) {
          m.frame = frame;
          m.sprite.setTexture(m.def.frames[frame]);
        }
        if (showFamily) {
          const parent = this.monsters.get(m.ppid);
          if (parent) {
            this.familyGfx.lineStyle(3, 0xef7fdc, 0.85);
            this.familyGfx.lineBetween(parent.sprite.x, parent.sprite.y, x, y);
          }
        }
      }
    }
  }

  DS.BattleScene = BattleScene;
})();
