// DotShell 스프라이트 생성기
//
//   node tools/sprites.mjs                  → src/renderer/assets/sprites/*.png 생성
//   node tools/sprites.mjs --preview a.png  → 확인용 미리보기 시트도 함께 생성
//
// 규칙 (docs/DotShell_기획서.md "아트 방향")
//  - 기준 에셋: Kenney Monochrome RPG / Pirates (CC0), 16x16, 4색 보라 팔레트
//  - 환경(땅·나무·동굴)은 원본 보라 그대로 → env-*.png 시트를 그대로 복사
//  - 주인공·몬스터·아이템은 배경을 투명하게 따고, 명도 4단계를 유지한 채 고유 색 램프로 채색
//  - Kenney에 없는 것은 같은 팔레트 규칙의 픽셀 맵으로 직접 그린다
//
// 픽셀 맵 문자: '.' 투명, '0'~'3' 팔레트 단계(0 가장 밝음, 3 외곽선), 그 밖의 글자는 extra 색
// 8글자짜리 줄은 좌우 대칭으로 미러링해서 16글자로 만든다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(here, '..');
const REPO = path.resolve(CLIENT, '..');
const OUT = path.join(CLIENT, 'src', 'renderer', 'assets', 'sprites');

const SHEETS = {
  rpg: path.join(REPO, 'assets', 'kenney_monochrome-rpg', 'Default', 'Tilemap', 'tilemap_packed.png'),
  pirates: path.join(REPO, 'assets', 'kenney_monochrome-pirates', 'Default', 'Tilemap', 'tilemap_packed.png'),
};
const SHEET_COLS = 17;
const T = 16;

// Kenney 원본 팔레트 → 단계
const PALETTE = ['#b5b0dd', '#8e8bb7', '#666389', '#44415d'];

// 색 램프: [밝음, 밝은 중간, 어두운 중간, 외곽선]
const RAMPS = {
  hero: ['#fff1d6', '#8fc1ff', '#3d6fd8', '#1d1b3a'],
  daemon: ['#f4ffff', '#9ff3ff', '#3fb6d8', '#1d2a4a'],
  bug: ['#f2ffe0', '#8ee65a', '#2f9e44', '#14231a'],
  queen: ['#fff0fb', '#ef7fdc', '#9b3196', '#2a1030'],
  core: ['#f2ffff', '#7ff3f0', '#2aa3b5', '#163447'],
  wood: ['#f6dcae', '#c98b4a', '#8a5530', '#2e1d14'],
  paper: ['#fff8e6', '#ead39f', '#a8844f', '#3b2a1a'],
  gold: ['#fff4c2', '#ffd447', '#c98b1a', '#4a2f0a'],
  chest: ['#fff1c9', '#d99a4e', '#8a5530', '#2e1d14'],
  heart: ['#ffe0e0', '#ff5d6c', '#b3243a', '#3a0f18'],
  heartEmpty: ['#4a2a3a', '#4a2a3a', '#b3243a', '#3a0f18'],
  riftStone: ['#d8d0f0', '#9a93c9', '#5d5794', '#241f3d'],
  steel: ['#ffffff', '#cfe0f5', '#7d93bd', '#232a45'],
  // 집 지붕 색 (디렉터리마다 이름으로 골라 쓴다)
  roofRed: ['#ffd0c8', '#e8574a', '#a3302a', '#2a1418'],
  roofBlue: ['#d6e6ff', '#4f7ee0', '#2c4a9a', '#141a2e'],
  roofGreen: ['#dfffd0', '#5fbf4a', '#2f7a2a', '#12240f'],
  roofGold: ['#fff2c8', '#f0a93a', '#a8651c', '#2e1a08'],
  bone: ['#ffffff', '#e0dcf0', '#9a96b8', '#2b2940'],
};
const EXTRA = {
  Y: '#ffd447', R: '#ff4d6d', G: '#7dff9a',
  // 균열 안쪽 소용돌이
  D: '#120a1f', V: '#3a1758', P: '#8a2fc9', Q: '#ff4dd2', E: '#ff3b3b',
  // 집 벽·문·창
  w: '#f3eefc', x: '#cfc8ea', a: '#c98b4a', b: '#8a5530', g: '#9ff3ff',
};

// ── 마을의 집 (32x32, 코드로 그림) ─────────────────────────────────────
// 지붕만 색 램프(0~3)를 쓰고, 벽·문·창은 고정색. 디렉터리 하나 = 집 한 채.
function houseGrid() {
  const W = 32;
  const H = 32;
  const g = Array.from({ length: H }, () => Array(W).fill(-1));
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = v; };
  // 굴뚝 (지붕보다 먼저, 지붕이 아래쪽을 덮는다)
  for (let y = 3; y <= 9; y++) for (let x = 22; x <= 25; x++) set(x, y, x === 22 || x === 25 || y === 3 ? 3 : 2);
  // 지붕: 꼭대기 y=1, 처마 y=13
  for (let y = 1; y <= 13; y++) {
    const half = 1.5 + (y - 1) * 1.2;
    const l = Math.round(15.5 - half);
    const r = Math.round(15.5 + half);
    for (let x = l; x <= r; x++) {
      let v = y % 3 === 0 ? 2 : 1; // 기와 줄
      if (x < l + 3 && y > 2) v = 0; // 왼쪽 하이라이트
      if (x === l || x === r || y === 1 || y === 13) v = 3;
      set(x, y, v);
    }
  }
  // 벽
  for (let y = 14; y <= 29; y++) for (let x = 3; x <= 28; x++) set(x, y, x === 3 || x === 28 ? 3 : y > 26 ? 'x' : 'w');
  for (let x = 2; x <= 29; x++) set(x, 30, 3);
  // 문
  for (let y = 19; y <= 29; y++) for (let x = 13; x <= 18; x++) set(x, y, x === 13 || x === 18 || y === 19 ? 3 : x < 16 ? 'a' : 'b');
  set(17, 25, 'Y');
  // 창문 두 개
  for (const wx of [6, 21]) {
    for (let y = 17; y <= 21; y++) {
      for (let x = wx; x <= wx + 4; x++) {
        const edge = x === wx || x === wx + 4 || y === 17 || y === 21;
        set(x, y, edge || x === wx + 2 || y === 19 ? 3 : 'g');
      }
    }
  }
  return g;
}

// ── 적이 나오는 균열 문 (32x36, 코드로 그림) ──────────────────────────
// 둥근 아치 + 기둥 모양 돌 고리, 고리에 붉은 룬, 안쪽은 프레임마다 도는 소용돌이.
function riftFrame(frame) {
  const W = 32;
  const H = 36;
  const cx = 15.5;
  const cy = 15;
  const rOut = 15.5;
  const rIn = 10;
  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = y <= cy ? Math.hypot(dx, dy) : Math.abs(dx); // 위는 둥글게, 아래는 곧은 기둥
      if (d > rOut) { row.push(-1); continue; }
      if (d > rIn) {
        if (d > rOut - 1.1 || d < rIn + 1.1) { row.push(3); continue; }
        let shade;
        if (y <= cy) {
          const seg = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 8));
          const edge = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 8)) % 1;
          if (edge < 0.12) { row.push(3); continue; } // 돌 사이 줄눈
          shade = seg % 2 ? 1 : 2;
          if (seg % 4 === 1 && Math.abs(d - (rIn + rOut) / 2) < 1 && (seg + frame) % 3 !== 0) { row.push('E'); continue; } // 룬
        } else {
          if (y % 5 === 0) { row.push(3); continue; }
          shade = Math.floor(y / 5) % 2 ? 1 : 2;
        }
        if (dx < 0 && d > rOut - 3) shade = Math.max(0, shade - 1); // 왼쪽 위 하이라이트
        row.push(shade);
        continue;
      }
      // 안쪽 소용돌이
      const ry = y <= cy ? dy : dy * 0.3;
      const r = Math.min(1, Math.hypot(dx, ry) / rIn);
      const a = Math.atan2(ry, dx);
      const swirl = Math.sin(a * 3 + r * 9 - frame * 2.1);
      const rim = y <= cy ? Math.hypot(dx, dy) / rIn : Math.abs(dx) / rIn; // 테두리는 돌 고리를 따라서만
      if (rim > 0.86) row.push('Q');
      else if (swirl > 0.55) row.push('P');
      else if (swirl > -0.15) row.push('V');
      else row.push('D');
    }
    grid.push(row);
  }
  return grid;
}

// ── 직접 그린 스프라이트 (왼쪽 절반, 미러링) ─────────────────────────────
const CUSTOM = {
  bug_0: { ramp: 'bug', rows: [
    '........', '....3...', '.....3..', '....3333',
    '...32222', '...32002', '...32032', '..333333',
    '.3112113', '.3211113', '.3111213', '.3121113',
    '..311113', '...33333', '..3.3...', '........',
  ] },
  bug_1: { ramp: 'bug', rows: [
    '........', '...3....', '....3...', '....3333',
    '...32222', '...32002', '...32032', '..333333',
    '.3112113', '.3211113', '.3111213', '.3121113',
    '..311113', '...33333', '...3.3..', '........',
  ] },
  queen_0: { ramp: 'queen', rows: [
    '....Y.Y.', '....YYYY', '...3YRYY', '...33333',
    '..322222', '..320022', '..320322', '.3333333',
    '31121123', '31211113', '31112113', '31211113',
    '.3111213', '..333333', '.3.3.3..', '........',
  ] },
  queen_1: { ramp: 'queen', rows: [
    '....Y.Y.', '....YYYY', '...3YRYY', '...33333',
    '..322222', '..320022', '..320322', '.3333333',
    '31121123', '31211113', '31112113', '31211113',
    '.3111213', '..333333', '..3.3.3.', '........',
  ] },
  core: { ramp: 'core', rows: [
    '.......3', '......30', '.....301', '....3011',
    '...30111', '...30112', '...31112', '....3112',
    '.....312', '......32', '....3333', '...32222',
    '...32Y22', '..322222', '..333333', '........',
  ] },
  scroll: { ramp: 'paper', rows: [
    '........', '..333333', '.3111111', '.3333333',
    '..300000', '..302222', '..300000', '..302222',
    '..300000', '..302200', '..300000', '.3333333',
    '.3111111', '..333333', '........', '........',
  ] },
};

// ── Kenney 타일을 채색해서 쓰는 스프라이트 ──────────────────────────────
const KENNEY = {
  hero: { sheet: 'rpg', index: 121, ramp: 'hero' },
  daemon: { sheet: 'rpg', index: 125, ramp: 'daemon' },
  door: { sheet: 'rpg', index: 109, ramp: 'wood' },
  key: { sheet: 'pirates', index: 117, ramp: 'gold' },
  chest: { sheet: 'pirates', index: 134, ramp: 'chest' },
  heart_full: { sheet: 'rpg', index: 129, ramp: 'heart' },
  heart_half: { sheet: 'rpg', index: 128, ramp: 'heart' },
  heart_empty: { sheet: 'rpg', index: 127, ramp: 'heartEmpty' },
  skull: { sheet: 'pirates', index: 122, ramp: 'bone' },
  dagger: { sheet: 'pirates', index: 123, ramp: 'steel' },
  sword: { sheet: 'rpg', index: 126, ramp: 'steel' },
};

// ─────────────────────────────────────────────────────────────────────
function hex(color) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const sheetCache = {};
function loadSheet(name) {
  if (!sheetCache[name]) sheetCache[name] = PNG.sync.read(fs.readFileSync(SHEETS[name]));
  return sheetCache[name];
}

/** Kenney 타일 → 단계 격자 (-1 투명) */
function kenneyGrid(sheetName, index) {
  const png = loadSheet(sheetName);
  const ox = (index % SHEET_COLS) * T;
  const oy = Math.floor(index / SHEET_COLS) * T;
  const palette = PALETTE.map(hex);
  const grid = [];
  for (let y = 0; y < T; y++) {
    const row = [];
    for (let x = 0; x < T; x++) {
      const i = ((oy + y) * png.width + (ox + x)) * 4;
      if (png.data[i + 3] < 128) { row.push(-1); continue; }
      const rgb = [png.data[i], png.data[i + 1], png.data[i + 2]];
      let best = 0;
      let bestD = Infinity;
      palette.forEach((p, k) => {
        const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      });
      row.push(best);
    }
    grid.push(row);
  }
  return grid;
}

/** 가장자리와 이어진 가장 밝은 바탕(0)을 투명하게 딴다. */
function removeBackground(grid) {
  const stack = [];
  for (let i = 0; i < T; i++) stack.push([i, 0], [i, T - 1], [0, i], [T - 1, i]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= T || y >= T) continue;
    if (grid[y][x] !== 0) continue;
    grid[y][x] = -1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return removeSpecks(grid);
}

/** 본체와 떨어진 작은 픽셀 덩어리(타일에 섞인 풀 조각 등)를 지운다. */
function removeSpecks(grid, minSize = 6) {
  const seen = grid.map((row) => row.map(() => false));
  for (let sy = 0; sy < T; sy++) {
    for (let sx = 0; sx < T; sx++) {
      if (seen[sy][sx] || grid[sy][sx] === -1) continue;
      const part = [];
      const stack = [[sx, sy]];
      while (stack.length) {
        const [x, y] = stack.pop();
        if (x < 0 || y < 0 || x >= T || y >= T || seen[y][x] || grid[y][x] === -1) continue;
        seen[y][x] = true;
        part.push([x, y]);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      if (part.length < minSize) part.forEach(([x, y]) => { grid[y][x] = -1; });
    }
  }
  return grid;
}

/** 픽셀 맵 문자열 → 격자 (단계 숫자 또는 extra 글자) */
function customGrid(rows) {
  return rows.map((row) => {
    const full = row.length === 8 ? row + [...row].reverse().join('') : row;
    if (full.length !== T) throw new Error(`16칸이 아닌 줄: "${row}"`);
    return [...full].map((ch) => (ch === '.' ? -1 : /[0-3]/.test(ch) ? Number(ch) : ch));
  });
}

function paint(grid, rampName) {
  const ramp = RAMPS[rampName].map(hex);
  const h = grid.length;
  const w = grid[0].length;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = grid[y][x];
      const i = (y * w + x) * 4;
      if (v === -1) { png.data[i + 3] = 0; continue; }
      const [r, g, b] = typeof v === 'number' ? ramp[v] : hex(EXTRA[v]);
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
  return png;
}

function writePng(file, png) {
  fs.writeFileSync(file, PNG.sync.write(png));
}

// ── 생성 ──────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const made = {};

for (const [name, def] of Object.entries(KENNEY)) {
  made[name] = paint(removeBackground(kenneyGrid(def.sheet, def.index)), def.ramp);
}
for (const [name, def] of Object.entries(CUSTOM)) {
  made[name] = paint(customGrid(def.rows), def.ramp);
}
for (let f = 0; f < 3; f++) {
  made[`rift_${f}`] = paint(riftFrame(f), 'riftStone');
}
for (const roof of ['Red', 'Blue', 'Green', 'Gold']) {
  made[`house_${roof.toLowerCase()}`] = paint(houseGrid(), `roof${roof}`);
}
for (const [name, png] of Object.entries(made)) {
  writePng(path.join(OUT, `${name}.png`), png);
}
// 환경 타일 시트는 원본 그대로
fs.copyFileSync(SHEETS.rpg, path.join(OUT, 'env-rpg.png'));
fs.copyFileSync(SHEETS.pirates, path.join(OUT, 'env-pirates.png'));

console.log(`스프라이트 ${Object.keys(made).length}개 + 환경 시트 2개 → ${path.relative(REPO, OUT)}`);
console.log(Object.keys(made).join(', '));

// ── 미리보기: 원본 바탕 두 종류 위에 4배로 ────────────────────────────
const previewIdx = process.argv.indexOf('--preview');
if (previewIdx > 0) {
  const names = Object.keys(made);
  const S = 4;
  const cell = Math.max(...names.map((n) => Math.max(made[n].width, made[n].height))) * S + 8;
  const preview = new PNG({ width: names.length * cell, height: cell * 2 });
  const bgs = [hex(PALETTE[0]), hex(PALETTE[1])];
  for (let row = 0; row < 2; row++) {
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < preview.width; x++) {
        const i = ((row * cell + y) * preview.width + x) * 4;
        [preview.data[i], preview.data[i + 1], preview.data[i + 2]] = bgs[row];
        preview.data[i + 3] = 255;
      }
    }
    names.forEach((name, n) => {
      const png = made[name];
      for (let y = 0; y < png.height * S; y++) {
        for (let x = 0; x < png.width * S; x++) {
          const si = (Math.floor(y / S) * png.width + Math.floor(x / S)) * 4;
          if (png.data[si + 3] === 0) continue;
          const di = ((row * cell + 4 + y) * preview.width + (n * cell + 4 + x)) * 4;
          preview.data[di] = png.data[si];
          preview.data[di + 1] = png.data[si + 1];
          preview.data[di + 2] = png.data[si + 2];
          preview.data[di + 3] = 255;
        }
      }
    });
  }
  writePng(process.argv[previewIdx + 1], preview);
  console.log(`미리보기 → ${process.argv[previewIdx + 1]}`);
}
