// 게임 시작과 장면 전환. 현재 위치(cwd)가 ~/rift 안이면 전투, 아니면 마을.
(function () {
  'use strict';

  const ready = {};
  const pending = [];
  let mode = 'village';

  DS.onSceneReady = (name, scene) => {
    ready[name] = scene;
    if (name === 'village') scene.scene.launch('battle');
    if (name === 'battle') scene.scene.sleep(); // 균열에 들어가기 전까지 잠들어 있다
    if (ready.village && ready.battle) pending.splice(0).forEach(([fn, arg]) => dispatch[fn](arg));
  };

  DS.switchScene = (target) => {
    if (target === mode) return;
    const from = ready[mode];
    const to = ready[target];
    mode = target;
    from.scene.sleep();
    to.scene.wake();
    to.cameras.main.fadeIn(400, 26, 28, 44);
  };

  const active = () => ready[mode];

  const dispatch = {
    onState(st) {
      if (mode === 'battle') {
        if (DS.inRift(st.cwd)) {
          ready.battle.onState(st);
        } else {
          DS.switchScene('village');
          ready.village.returnFromRift(st);
        }
      } else {
        ready.village.onState(st);
      }
    },
    onStage: (m) => ready.battle.onStage(m),
    onWorld: (m) => ready.battle.onWorld(m),
    onResult: (m) => ready.battle.onResult(m),
    onAnnounce: (m) => ready.battle.onAnnounce(m), // 스테이지 대사는 균열 안(전투)의 것
    onTyping(data) {
      if (!data || data.startsWith('\u001b')) return; // 방향키 등
      active().onTyping(data);
    },
    setPaused(paused) {
      const scene = active();
      if (paused) scene.scene.pause();
      else scene.scene.resume();
    },
    reset() {
      if (mode !== 'village') DS.switchScene('village');
      ready.village.resetAll();
      ready.battle.resetAll();
    },
  };

  window.DotGame = {};
  Object.keys(dispatch).forEach((name) => {
    window.DotGame[name] = (arg) => {
      if (ready.village && ready.battle) dispatch[name](arg);
      else pending.push([name, arg]);
    };
  });

  function startGame() {
    new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'world',
      width: DS.W,
      height: DS.H,
      pixelArt: true,
      backgroundColor: '#8e8bb7',
      banner: false,
      loader: { imageLoadType: 'HTMLImageElement' },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [DS.VillageScene, DS.BattleScene],
    });
  }

  // 도트 글꼴을 먼저 받아야 Phaser 텍스트가 제 글꼴로 그려진다.
  Promise.all([document.fonts.load(`16px ${DS.FONT}`), document.fonts.load(`16px ${DS.FONT}`, '가나다')])
    .catch(() => {})
    .then(startGame);
})();
