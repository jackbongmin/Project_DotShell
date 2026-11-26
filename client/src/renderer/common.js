// DotShell 게임 화면 공용: 상수, 스프라이트 목록, 효과 함수
(function () {
  'use strict';

  const S = 3; // 16px 도트를 3배로
  const TILE = 16 * S;
  const COLS = 20;
  const ROWS = 11;
  const HOME = '/home/hero';
  const RIFT = `${HOME}/rift`;

  const SPRITES = [
    'hero', 'daemon', 'door', 'key', 'chest', 'heart_full', 'heart_half', 'heart_empty', 'skull', 'dagger', 'sword',
    'bug_0', 'bug_1', 'queen_0', 'queen_1', 'core', 'scroll', 'rift_0', 'rift_1', 'rift_2',
    'house_red', 'house_blue', 'house_green', 'house_gold',
  ];

  function hash(n) {
    let x = (n * 2654435761) >>> 0;
    x ^= x >>> 13;
    return x;
  }

  function hashStr(s) {
    let h = 2166136261;
    for (const ch of s) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** sudo·time 같은 앞말을 건너뛴 첫 단어와 나머지 인자 */
  function parseCommand(command) {
    const words = (command || '').trim().split(/\s+/).filter(Boolean);
    while (words.length && /^(sudo|time|command|nohup)$/.test(words[0])) words.shift();
    const word = words[0] || '';
    const args = words.slice(1).filter((w) => !w.startsWith('-'));
    const flags = words.slice(1).filter((w) => w.startsWith('-')).join(' ');
    return { word, args, flags };
  }

  function inRift(cwd) {
    return cwd === RIFT || (cwd || '').startsWith(`${RIFT}/`);
  }

  function basename(path) {
    const parts = path.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || '/';
  }

  function preload(scene) {
    SPRITES.forEach((k) => scene.load.image(k, `assets/sprites/${k}.png`));
    scene.load.spritesheet('env', 'assets/sprites/env-rpg.png', { frameWidth: 16, frameHeight: 16 });
    scene.load.spritesheet('env2', 'assets/sprites/env-pirates.png', { frameWidth: 16, frameHeight: 16 });
  }

  function makeTextures(scene) {
    if (scene.textures.exists('px')) return;
    const px = scene.textures.createCanvas('px', 4, 4);
    px.getContext().fillStyle = '#ffffff';
    px.getContext().fillRect(0, 0, 4, 4);
    px.refresh();
  }

  function burst(scene, x, y, color, count) {
    const emitter = scene.add.particles(x, y, 'px', {
      speed: { min: 60, max: 240 }, angle: { min: 0, max: 360 }, lifespan: { min: 300, max: 650 },
      scale: { start: 1.6, end: 0 }, tint: color, emitting: false,
    }).setDepth(1050);
    emitter.explode(count);
    scene.time.delayedCall(900, () => emitter.destroy());
  }

  function floatText(scene, x, y, text, color, size) {
    const t = scene.add.text(x, y, text, {
      fontFamily: 'Galmuri11', fontSize: `${size}px`, color, stroke: '#1a1c2c', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(1070);
    scene.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 900, ease: 'Quad.Out', onComplete: () => t.destroy() });
  }

  /** 데몬 말풍선. say(text, ms) */
  function makeBubble(scene, anchor) {
    const box = scene.add.container(0, 0).setDepth(1000).setVisible(false);
    const bg = scene.add.graphics();
    const text = scene.add.text(12, 9, '', {
      fontFamily: 'Galmuri11', fontSize: '18px', color: '#1a1c2c', wordWrap: { width: 360, useAdvancedWrap: true }, lineSpacing: 4,
    });
    box.add([bg, text]);
    return {
      box,
      say(message, ms) {
        text.setText(message);
        const w = Math.min(384, text.width + 24);
        const h = text.height + 18;
        bg.clear();
        bg.fillStyle(0xf4f4f4, 0.97);
        bg.fillRoundedRect(0, 0, w, h, 8);
        bg.lineStyle(3, 0x1a1c2c, 1);
        bg.strokeRoundedRect(0, 0, w, h, 8);
        bg.fillStyle(0xf4f4f4, 1);
        bg.fillTriangle(14, h - 2, 30, h - 2, 6, h + 14);
        bg.lineStyle(3, 0x1a1c2c, 1);
        bg.lineBetween(14, h, 6, h + 14);
        bg.lineBetween(30, h, 6, h + 14);
        box.setData('h', h);
        box.setVisible(true).setAlpha(0);
        this.follow();
        scene.tweens.killTweensOf(box);
        scene.tweens.add({ targets: box, alpha: 1, duration: 150 });
        scene.tweens.add({ targets: box, alpha: 0, delay: ms, duration: 300 });
      },
      follow() {
        const h = box.getData('h') || 40;
        const x = Phaser.Math.Clamp(anchor.x + 6, 4, COLS * TILE - 390);
        box.setPosition(x, Math.max(TILE + 4, anchor.y - 30 - h));
      },
    };
  }

  window.DS = {
    S, TILE, COLS, ROWS, W: COLS * TILE, H: ROWS * TILE, FONT: 'Galmuri11', HOME, RIFT,
    hash, hashStr, parseCommand, inRift, basename, preload, makeTextures, burst, floatText, makeBubble,
  };
})();
