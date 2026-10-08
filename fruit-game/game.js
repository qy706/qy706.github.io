/* =========================================================================
 *  旋转刀切水果大战
 *  ---------------------------------------------------------------------
 *  玩法（见《旋转刀切水果玩法.txt》）：
 *   1. 斧头 / 刀 / 飞镖 三种武器，开局掷色子 1-6 决定（除以 2 取整 → 3 种）
 *   2. 点开始后武器位于屏幕正中心，水果从各个方向旋转着飞出并下落
 *   3. 左下角输入数学公式（默认 sinx），以屏幕正中心为原点建立直角坐标系，
 *      武器按公式轨迹运行，切水果得分；20s 后加速 + 每 8s 炸弹；
 *      40s 后更快 + 每 4s 炸弹；60s 结算
 *   4. 武器走过的轨迹点出现光亮，2 秒后光亮消失；右边系统按钮可暂停（继续/退出）
 *   5. 记录历史最高分（默认 0）
 * ========================================================================= */
'use strict';

/* ======================= 基础常量 ======================= */
const STAGE_W = 540, STAGE_H = 960;          // 逻辑舞台尺寸（9:16，与素材一致）
const CX = STAGE_W / 2, CY = STAGE_H / 2;    // 屏幕正中心 = 直角坐标系原点
const PX_PER_UNIT = 100;                     // 1 个数学单位 = 100 逻辑像素
const XMAX = CX / PX_PER_UNIT;               // x ∈ [-2.7, 2.7]
const YMAX = CY / PX_PER_UNIT;               // y ∈ [-4.8, 4.8]

const ROUND_TIME   = 60;      // 一局时长（秒）
const GLOW_LIFE    = 2.0;     // 轨迹光亮存活时间（秒）
const GRAVITY      = 780;     // 重力加速度（逻辑像素/秒²）
const BOMB_PENALTY = 40;      // 切到炸弹扣分
const OUT_MARGIN   = 240;     // 出界多远后回收

// 炸弹出现时刻（秒）：20s 后每 8s 一个，40s 后每 4s 一个
const BOMB_TIMES = [20, 28, 36, 40, 44, 48, 52, 56];

// 三个阶段
const PHASES = [
  { i:1, spawn:1.15, speed:1.00, min:1, max:1, tip:'水果正常下落' },
  { i:2, spawn:0.92, speed:1.22, min:1, max:2, tip:'水果加速 · 每8秒炸弹' },
  { i:3, spawn:0.74, speed:1.45, min:2, max:3, tip:'水果更快 · 每4秒炸弹' }
];
function phaseOf(t){ return t < 20 ? PHASES[0] : (t < 40 ? PHASES[1] : PHASES[2]); }

/* --------- 素材几何：content bbox（2048×2048 内），用于把图片内容对准中心 --------- */
const SPR = {
  apple:      { f:'apple.png',      bw:1423, bh:1468, cx:1030.5, cy:1034.0 },
  axe:        { f:'axe.png',        bw:1297, bh:1528, cx:1047.5, cy:1072.0 },
  banana:     { f:'banana.png',     bw:1267, bh:1175, cx:1025.5, cy:1013.5 },
  bomb:       { f:'bomb.png',       bw:1065, bh:1572, cx:1027.5, cy:1042.0 },
  dart:       { f:'dart.png',       bw:1450, bh:1378, cx:1021.0, cy:1043.0 },
  dice:       { f:'dice.png',       bw:1449, bh:1494, cx:1030.5, cy:1034.0 },
  grape:      { f:'grape.png',      bw:1175, bh:1695, cx:1022.5, cy:1031.5 },
  knife:      { f:'knife.png',      bw:1291, bh:1651, cx:1045.5, cy:1036.5 },
  orange:     { f:'orange.png',     bw:1360, bh:1600, cx:1034.0, cy:1030.0 },
  peach:      { f:'peach.png',      bw:1312, bh:1423, cx:1030.0, cy:1042.5 },
  pineapple:  { f:'pineapple.png',  bw:963,  bh:1689, cx:1026.5, cy:1027.5 },
  strawberry: { f:'strawberry.png', bw:1162, bh:1570, cx:1029.0, cy:1028.0 },
  watermelon: { f:'watermelon.png', bw:1211, bh:1348, cx:1024.5, cy:1046.0 }
};

/* --------- 水果表：size = 内容最长边（逻辑像素），pts = 分数 --------- */
const FRUITS = [
  { k:'grape',      size:46, pts: 8 },
  { k:'apple',      size:60, pts:10 },
  { k:'orange',     size:64, pts:10 },
  { k:'banana',     size:64, pts:12 },
  { k:'peach',       size:60, pts:12 },
  { k:'strawberry', size:54, pts:15 },
  { k:'pineapple',  size:70, pts:20 },
  { k:'watermelon', size:76, pts:25 }
];

/* --------- 武器表 ---------
 * leadAxis：素材“刃/尖”方向相对图片坐标系的夹角（弧度）。
 *   由素材主惯性轴与色带分析得到：
 *     刀  主轴 -54.3°，亮银白色（刃）在 -u 端 → 刃朝 -u
 *     斧  主轴 -53.4°，木色手柄在 -u 端，钢色斧头在 +u 端 → 头朝 +u
 *     镖  主轴 -45.1°，亮金属尖在 -u 端，红色尾在 +u 端 → 尖朝 -u
 * ------------------------------------------------------------------------- */
const WEAPONS = {
  axe:   { name:'斧头', icon:'axe.png',   len:120, leadAxis:deg(-53.4), glow:'255,170,60'  },
  knife: { name:'刀',   icon:'knife.png', len:118, leadAxis:deg(125.7), glow:'180,235,255' },
  dart:  { name:'飞镖', icon:'dart.png',  len:112, leadAxis:deg(134.9), glow:'255,90,80'   }
};
const WEAPON_ORDER = ['axe', 'knife', 'dart'];   // 色子 1·2→斧头  3·4→刀  5·6→飞镖
function deg(d){ return d * Math.PI / 180; }

/* ======================= 小工具 ======================= */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

/** 点到线段的距离 */
function segDist(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/* =========================================================================
 *  1) 数学公式解析器
 *  支持：+ - * / ^ 、括号、隐式乘法(2x / 3sin(x) / x(x+1))、
 *        函数连写(sinx → sin(x)、sin2x → sin(2x))、
 *        一元函数、二元函数、常数 pi / e、变量 x（或参数方程里的 t）
 * ========================================================================= */
const FN1 = {
  sin:Math.sin, cos:Math.cos, tan:Math.tan,
  asin:Math.asin, acos:Math.acos, atan:Math.atan,
  sinh:Math.sinh, cosh:Math.cosh, tanh:Math.tanh,
  sqrt:Math.sqrt, cbrt:Math.cbrt, abs:Math.abs, exp:Math.exp,
  ln:Math.log, log:Math.log10, lg:Math.log10, log10:Math.log10, log2:Math.log2,
  floor:Math.floor, ceil:Math.ceil, round:Math.round, sign:Math.sign,
  frac:v => v - Math.floor(v)
};
const FN2 = {
  pow:Math.pow, atan2:Math.atan2, min:Math.min, max:Math.max,
  mod:(a, b) => a - b * Math.floor(a / b)
};
const CONST = { pi:Math.PI, 'π':Math.PI, tau:2 * Math.PI, e:Math.E };
const ALLFN = Object.keys(FN1).concat(Object.keys(FN2)).sort((a, b) => b.length - a.length);
const CONSTKEYS = ['pi', 'e'];

/** 词法分析
 *  标识符允许包含数字（这样 log10 / log2 / atan2 能正常识别），
 *  遇到未登记的整词再按“最长已知名称前缀”逐段拆分：
 *    sin2x → sin · 2 · x      log10 → log10（整词已知）
 *    ex    → e · x            x2    → x · 2
 */
function tokenize(src, vars){
  const out = [];
  const isDigit = c => c >= '0' && c <= '9';
  const isAlpha = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === 'π';
  const isWordCh = c => isAlpha(c) || isDigit(c);
  const isKnown = n =>
    FN1[n] !== undefined || FN2[n] !== undefined || CONST[n] !== undefined || vars.has(n);

  // 整词未登记时，取“最长的已知名称前缀”
  function longestPrefix(low){
    let best = null;
    const consider = n => {
      if (n.length < low.length && low.startsWith(n) && (!best || n.length > best.length)) best = n;
    };
    for (const n of ALLFN) consider(n);
    for (const n of CONSTKEYS) consider(n);
    for (const n of vars) consider(n);
    return best;
  }

  let i = 0;
  while (i < src.length){
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r'){ i++; continue; }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))){
      let j = i;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++;
      const s = src.slice(i, j);
      if ((s.match(/\./g) || []).length > 1) throw new Error('数字格式错误：' + s);
      out.push({ k:'num', v: parseFloat(s) });
      i = j; continue;
    }

    if (isAlpha(c)){
      let j = i;
      while (j < src.length && isWordCh(src[j])) j++;
      let word = src.slice(i, j).toLowerCase();
      i = j;

      while (word.length){
        if (isKnown(word)){ out.push({ k:'id', v:word }); break; }

        const dm = /^[0-9]+(\.[0-9]+)?/.exec(word);      // 拆分后的纯数字余数
        if (dm){
          out.push({ k:'num', v: parseFloat(dm[0]) });
          word = word.slice(dm[0].length);
          continue;
        }
        if (word === 'x' && !vars.has('x'))
          throw new Error('参数方程请使用变量 t，例如：2.6cos(t), 2.6sin(t)');

        const best = longestPrefix(word);
        if (!best) throw new Error('无法识别的名称：' + word);
        out.push({ k:'id', v:best });
        word = word.slice(best.length);
      }
      continue;
    }

    if ('+-*/^(),'.indexOf(c) >= 0){ out.push({ k:c }); i++; continue; }
    throw new Error('无法识别的字符：' + c);
  }
  out.push({ k:'end' });
  return out;
}

/** 语法分析（递归下降） */
function parse(src, vars){
  const T = tokenize(src, vars);
  let p = 0;
  const peek = () => T[p].k;
  const is = k => T[p].k === k;
  const eat = k => {
    if (!is(k)) throw new Error(k === ')' ? '括号不匹配' : '语法错误：表达式不完整');
    p++;
  };

  function parseExpr(){
    let n = parseTerm();
    while (is('+') || is('-')){
      const op = T[p].k; p++;
      n = { t:'bin', op, a:n, b:parseTerm() };
    }
    return n;
  }
  function parseTerm(){
    let n = parseUnary();
    for (;;){
      if (is('*') || is('/')){
        const op = T[p].k; p++;
        n = { t:'bin', op, a:n, b:parseUnary() };
      } else if (is('num') || is('id') || is('(')){
        n = { t:'bin', op:'*', a:n, b:parseUnary() };   // 隐式乘法
      } else break;
    }
    return n;
  }
  function parseUnary(){
    if (is('-')){ p++; return { t:'neg', a:parseUnary() }; }
    if (is('+')){ p++; return parseUnary(); }
    return parsePower();
  }
  function parsePower(){
    const base = parseAtom();
    if (is('^')){ p++; return { t:'bin', op:'^', a:base, b:parseUnary() }; }
    return base;
  }
  function parseImplicitArg(fname){
    if (!(is('num') || is('id') || is('(')))
      throw new Error('函数 ' + fname + ' 缺少参数，例如 ' + fname + '(x)');
    let n = parsePower();
    while (is('num') || is('id') || is('(')) n = { t:'bin', op:'*', a:n, b:parsePower() };
    return n;
  }
  function parseAtom(){
    if (is('num')){ const v = T[p].v; p++; return { t:'num', v }; }
    if (is('(')){ p++; const e = parseExpr(); eat(')'); return e; }
    if (is('id')){
      const name = T[p].v; p++;
      if (FN1[name] !== undefined){
        let arg;
        if (is('(')){ p++; arg = parseExpr(); eat(')'); }
        else arg = parseImplicitArg(name);
        return { t:'fn', name, arg };
      }
      if (FN2[name] !== undefined){
        eat('(');
        const a = parseExpr(); eat(','); const b = parseExpr(); eat(')');
        return { t:'fn2', name, a, b };
      }
      if (CONST[name] !== undefined) return { t:'num', v: CONST[name] };
      if (vars.has(name)) return { t:'var' };
      throw new Error('未知符号：' + name);
    }
    throw new Error('语法错误：表达式不完整');
  }

  const ast = parseExpr();
  if (!is('end')) throw new Error('语法错误：多余的字符');
  return ast;
}

/** 编译成 JS 函数 */
function compile(node){
  switch (node.t){
    case 'num': return '(' + node.v + ')';
    case 'var': return 'v';
    case 'neg': return '(-' + compile(node.a) + ')';
    case 'bin': {
      const op = node.op === '^' ? '**' : node.op;
      return '(' + compile(node.a) + op + compile(node.b) + ')';
    }
    case 'fn':  return 'F1.' + node.name + '(' + compile(node.arg) + ')';
    case 'fn2': return 'F2.' + node.name + '(' + compile(node.a) + ',' + compile(node.b) + ')';
  }
  throw new Error('内部错误');
}
function buildFn(src, vars){
  const code = 'return ' + compile(parse(src, vars)) + ';';
  return new Function('v', 'F1', 'F2', code);
}

/** 顶层逗号切分（忽略括号内的逗号） */
function splitTopLevel(s){
  const parts = []; let depth = 0, cur = '';
  for (const ch of s){
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0){ parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  return parts.map(x => x.trim()).filter(x => x.length > 0);
}

/* =========================================================================
 *  2) 轨迹构建：采样 → 弧长表 → 匀速运动
 * ========================================================================= */
function toScreen(xu, yu){
  const M = 130;                       // 允许略微出屏，避免武器长时间消失在画面外
  let sx = CX + xu * PX_PER_UNIT;
  let sy = CY - yu * PX_PER_UNIT;
  return { x: clamp(sx, -M, STAGE_W + M), y: clamp(sy, -M, STAGE_H + M) };
}

function buildPath(src){
  const parts = splitTopLevel(src);

  if (parts.length > 2) throw new Error('最多只能有两个表达式：x(t), y(t)');

  const N = 900;
  const pts = [];
  let closed = false;

  if (parts.length === 2){
    /* ---- 参数方程：x(t), y(t)，t ∈ [0, 2π] ---- */
    const varsX = new Set(['t']), varsY = new Set(['t']);
    const fx = buildFn(parts[0], varsX);
    const fy = buildFn(parts[1], varsY);
    closed = true;
    let last = { x:CX, y:CY };
    for (let i = 0; i < N; i++){
      const t = 2 * Math.PI * i / (N - 1);
      let xu = fx(t, FN1, FN2), yu = fy(t, FN1, FN2);
      if (!isFinite(xu)) xu = 0;
      if (!isFinite(yu)) yu = 0;
      const pt = toScreen(clamp(xu, -1e4, 1e4), clamp(yu, -1e4, 1e4));
      if (isFinite(pt.x) && isFinite(pt.y)) last = pt;
      pts.push({ x:last.x, y:last.y });
    }
    return finishPath(pts, true, parts);
  }

  /* ---- 普通函数：y = f(x)，x ∈ [-XMAX, XMAX] ---- */
  const f = buildFn(parts[0], new Set(['x', 't']));
  let last = { x:CX, y:CY };
  for (let i = 0; i < N; i++){
    const xu = -XMAX + (2 * XMAX) * i / (N - 1);
    let yu = f(xu, FN1, FN2);
    if (Number.isNaN(yu)) yu = (CY - last.y) / PX_PER_UNIT;      // 无定义处保持连续
    if (!isFinite(yu)) yu = yu > 0 ? 1e4 : -1e4;
    const pt = toScreen(xu, clamp(yu, -1e4, 1e4));
    if (isFinite(pt.x) && isFinite(pt.y)) last = pt;
    pts.push({ x:last.x, y:last.y });
  }
  return finishPath(pts, false, parts);
}

function finishPath(pts, closed, parts){
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + dist2(pts[i].x, pts[i].y, pts[i - 1].x, pts[i - 1].y));
  let total = cum[cum.length - 1];
  if (closed) total += dist2(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y);
  if (!(total > 1)) throw new Error('轨迹太短，换个公式试试');
  return { pts, cum, total, closed, parts, parametric: parts.length === 2 };
}

/** 把弧长映射进 [0,total]（开曲线来回，闭曲线循环） */
function mapS(path, s){
  const L = path.total;
  if (path.closed) return { s: ((s % L) + L) % L, dir: 1 };
  const P = 2 * L;
  const m = ((s % P) + P) % P;
  return m <= L ? { s:m, dir:1 } : { s:P - m, dir:-1 };
}

/** 弧长 → 坐标 */
function posAt(path, s){
  const { pts, cum } = path;
  const n = cum.length;
  if (s <= 0) return { x:pts[0].x, y:pts[0].y };
  if (s >= cum[n - 1]){
    if (path.closed){
      const extra = s - cum[n - 1];
      const d = dist2(pts[n - 1].x, pts[n - 1].y, pts[0].x, pts[0].y);
      const k = d > 0 ? clamp(extra / d, 0, 1) : 0;
      return { x: pts[n-1].x + (pts[0].x - pts[n-1].x) * k,
               y: pts[n-1].y + (pts[0].y - pts[n-1].y) * k };
    }
    return { x:pts[n - 1].x, y:pts[n - 1].y };
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1){
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const k = seg > 0 ? (s - cum[lo]) / seg : 0;
  return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * k,
           y: pts[lo].y + (pts[hi].y - pts[lo].y) * k };
}

/** 找离原点（屏幕正中）最近的采样点弧长 —— 武器从这里开始沿轨迹跑 */
function nearestS(path){
  let best = 0, bd = Infinity;
  for (let i = 0; i < path.pts.length; i++){
    const d = dist2(path.pts[i].x, path.pts[i].y, CX, CY);
    if (d < bd){ bd = d; best = i; }
  }
  return path.cum[best];
}

/* =========================================================================
 *  3) DOM 与画布
 * ========================================================================= */
const $ = id => document.getElementById(id);
const stage     = $('stage');
const canvas    = $('world');
const ctx       = canvas.getContext('2d');
const gameBg    = $('gameBg');
const hud       = $('hud');
const screenTitle = $('screenTitle');
const screenPause = $('screenPause');
const screenResult= $('screenResult');
const toastEl   = $('toast');

const IMG = {};
let renderScale = 1;

function resize(){
  const k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.transform = 'scale(' + k + ')';
  const s = clamp((window.devicePixelRatio || 1) * k, 1, 3);
  renderScale = s;
  canvas.width  = Math.round(STAGE_W * s);
  canvas.height = Math.round(STAGE_H * s);
  ctx.setTransform(s, 0, 0, s, 0, 0);
}

function loadImages(){
  const list = Object.keys(SPR).map(k => SPR[k].f);
  return Promise.all(list.map(f => new Promise(res => {
    const im = new Image();
    im.onload = () => { IMG[f] = im; res(); };
    im.onerror = () => { console.warn('图片载入失败：' + f); res(); };
    im.src = 'images/' + f;
  })));
}

/** 以内容几何中心为基准绘制精灵（当前变换的原点 = 目标点） */
function drawSpriteAt(name, size){
  const s = SPR[name], img = IMG[s.f];
  if (!img) return;
  const S = size * 2048 / Math.max(s.bw, s.bh);
  ctx.drawImage(img, -(s.cx / 2048) * S, -(s.cy / 2048) * S, S, S);
}

/* --------- 光晕贴图（预渲染，避免每帧建渐变） --------- */
const GLOW = {};
function makeGlow(rgb){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g2 = c.getContext('2d');
  const grd = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0,    'rgba(255,255,255,1)');
  grd.addColorStop(0.16, 'rgba(' + rgb + ',0.95)');
  grd.addColorStop(0.42, 'rgba(' + rgb + ',0.34)');
  grd.addColorStop(0.72, 'rgba(' + rgb + ',0.09)');
  grd.addColorStop(1,    'rgba(' + rgb + ',0)');
  g2.fillStyle = grd;
  g2.fillRect(0, 0, 128, 128);
  return c;
}

/* =========================================================================
 *  4) 游戏状态
 * ========================================================================= */
const G = {
  screen:'title',      // title | playing | paused | result
  paused:false,
  time:0, score:0, best:0,
  weapon:'knife', dice:0, rolling:false, rolled:false,
  fruits:[], halves:[], parts:[], floats:[], trail:[],
  path:null, guide:null, speed:500, dist:0, startS:0, enter:0,
  enterFrom:{ x:CX, y:CY },
  curW:{ x:CX, y:CY }, prevW:{ x:CX, y:CY }, moveAng:-Math.PI / 2, wAng:0,
  spawnT:0, bombIdx:0, fruitHits:0, bombHits:0,
  shake:0, flash:0, newRecord:false
};

const STORE_KEY = 'fruitknife.highscore.v1';
function loadBest(){
  try { return parseInt(localStorage.getItem(STORE_KEY) || '0', 10) || 0; }
  catch (e){ return 0; }
}
function saveBest(v){
  try { localStorage.setItem(STORE_KEY, String(v)); } catch (e){ /* file:// 下可能不可用 */ }
}

/* =========================================================================
 *  5) 生成水果 / 炸弹
 * ========================================================================= */
function spawnFruit(isBomb){
  const ph = phaseOf(G.time);
  const M = 70;

  // 出生点：随机贴在某条边上（各个方向都可能出来）
  let sx, sy;
  const r = Math.random();
  if (r < 0.42){ sx = rand(40, STAGE_W - 40); sy = STAGE_H + M; }        // 下方
  else if (r < 0.64){ sx = STAGE_W + M; sy = rand(120, STAGE_H - 60); }  // 右方
  else if (r < 0.86){ sx = -M; sy = rand(120, STAGE_H - 60); }           // 左方
  else { sx = rand(60, STAGE_W - 60); sy = -M; }                         // 上方

  // 目标点：保证一定会扫过画面内部
  const tx = rand(70, STAGE_W - 70);
  const ty = rand(STAGE_H * 0.16, STAGE_H * 0.74);
  const T  = rand(0.80, 1.35) / (isBomb ? 1 : ph.speed * 0.55 + 0.45);

  const vx = (tx - sx) / T;
  const vy = (ty - sy) / T - 0.5 * GRAVITY * T;   // 抛体解：T 秒后正好经过目标点

  if (isBomb){
    G.fruits.push({
      bomb:true, key:'bomb', size:66, pts:0, r:27,
      x:sx, y:sy, vx, vy, ang:rand(0, 6.28), spin:rand(-2.4, 2.4), life:0
    });
    return;
  }

  const f = FRUITS[randi(0, FRUITS.length - 1)];
  G.fruits.push({
    bomb:false, key:f.k, size:f.size, pts:f.pts, r:f.size * 0.5 * 0.86,
    x:sx, y:sy, vx, vy, ang:rand(0, 6.28), spin:rand(-3.0, 3.0), life:0
  });
}

/* =========================================================================
 *  6) 切割
 * ========================================================================= */
function sliceFruit(f){
  const cut = G.moveAng;                       // 切割方向 = 武器运动方向
  const nx = -Math.sin(cut), ny = Math.cos(cut);
  const sep = rand(95, 150);

  for (const side of [1, -1]){
    G.halves.push({
      key:f.key, size:f.size, side,
      x:f.x, y:f.y,
      vx:f.vx * 0.42 + nx * sep * side,
      vy:f.vy * 0.42 + ny * sep * side - rand(30, 90),
      rot:f.ang, spin:f.spin * 0.7 + rand(-1.6, 1.6) * side,
      cutLocal:cut - f.ang, life:0, max:1.35
    });
  }
  // 汁水粒子
  for (let i = 0; i < 12; i++){
    const a = rand(0, 6.28), sp = rand(50, 210);
    G.parts.push({ x:f.x, y:f.y, vx:Math.cos(a) * sp, vy:Math.sin(a) * sp - 40,
                   life:0, max:rand(0.35, 0.75), size:rand(2, 5), color:'255,235,150' });
  }
  G.floats.push({ x:f.x, y:f.y, text:'+' + f.pts, life:0, max:0.95, color:'255,228,110', size:26 });
}

function explodeBomb(b){
  G.score = Math.max(0, G.score - BOMB_PENALTY);
  G.bombHits++;
  G.flash = 0.55;
  G.shake = 16;
  for (let i = 0; i < 40; i++){
    const a = rand(0, 6.28), sp = rand(80, 420);
    G.parts.push({ x:b.x, y:b.y, vx:Math.cos(a) * sp, vy:Math.sin(a) * sp,
                   life:0, max:rand(0.3, 0.8), size:rand(2, 6),
                   color: i % 3 === 0 ? '255,240,190' : '255,120,50' });
  }
  G.floats.push({ x:b.x, y:b.y, text:'-' + BOMB_PENALTY, life:0, max:1.0, color:'255,110,90', size:30 });
}

/** 用“上一帧位置 → 这一帧位置”的线段做碰撞，避免高速穿透 */
function sliceCheck(){
  const x1 = G.prevW.x, y1 = G.prevW.y, x2 = G.curW.x, y2 = G.curW.y;
  if (dist2(x1, y1, x2, y2) < 0.01) return;

  for (let i = G.fruits.length - 1; i >= 0; i--){
    const f = G.fruits[i];
    if (segDist(f.x, f.y, x1, y1, x2, y2) <= f.r){
      G.fruits.splice(i, 1);
      if (f.bomb) explodeBomb(f);
      else { G.score += f.pts; G.fruitHits++; sliceFruit(f); }
    }
  }
}

/* =========================================================================
 *  7) 每帧更新
 * ========================================================================= */
function pushTrail(){
  const t = G.time;
  const last = G.trail[G.trail.length - 1];
  if (!last){ G.trail.push({ x:G.curW.x, y:G.curW.y, t }); return; }
  const d = dist2(G.curW.x, G.curW.y, last.x, last.y);
  if (d < 3) return;
  const n = clamp(Math.floor(d / 10), 1, 30);
  for (let i = 1; i <= n; i++){
    const k = i / n;
    G.trail.push({ x:last.x + (G.curW.x - last.x) * k,
                   y:last.y + (G.curW.y - last.y) * k, t });
  }
  if (G.trail.length > 1200) G.trail.splice(0, G.trail.length - 1200);
}

function updateWeapon(dt){
  const w = WEAPONS[G.weapon];
  G.prevW = { x:G.curW.x, y:G.curW.y };

  if (G.enter < 1){
    // 开局武器位于屏幕正中心，用 0.7 秒滑入轨迹（中途换公式时从当前位置滑过去）
    G.enter = Math.min(1, G.enter + dt / 0.7);
    const e = easeOutCubic(G.enter);
    const tgt = posAt(G.path, G.startS);
    G.curW = { x: G.enterFrom.x + (tgt.x - G.enterFrom.x) * e,
               y: G.enterFrom.y + (tgt.y - G.enterFrom.y) * e };
  } else {
    G.dist += G.speed * dt;
    const m = mapS(G.path, G.dist);
    const p = posAt(G.path, m.s);
    G.curW = { x:p.x, y:p.y };
  }

  const dx = G.curW.x - G.prevW.x, dy = G.curW.y - G.prevW.y;
  if (Math.hypot(dx, dy) > 0.35) G.moveAng = Math.atan2(dy, dx);
  G.wAng = G.moveAng - w.leadAxis;
}

function update(dt){
  G.time += dt;
  const ph = phaseOf(G.time);

  /* 生成水果 */
  G.spawnT -= dt;
  if (G.spawnT <= 0){
    G.spawnT += ph.spawn;
    const n = Math.random() < 0.45 ? ph.max : ph.min;
    for (let i = 0; i < n; i++) spawnFruit(false);
  }
  /* 炸弹时刻表 */
  while (G.bombIdx < BOMB_TIMES.length && G.time >= BOMB_TIMES[G.bombIdx]){
    G.bombIdx++;
    spawnFruit(true);
  }

  /* 武器 */
  updateWeapon(dt);
  pushTrail();
  sliceCheck();

  /* 水果 / 炸弹物理 */
  for (let i = G.fruits.length - 1; i >= 0; i--){
    const f = G.fruits[i];
    f.life += dt;
    f.vy += GRAVITY * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.ang += f.spin * dt;
    if (f.y > STAGE_H + OUT_MARGIN || f.y < -OUT_MARGIN * 2 ||
        f.x < -OUT_MARGIN || f.x > STAGE_W + OUT_MARGIN || f.life > 9)
      G.fruits.splice(i, 1);
  }

  /* 被切开的两半 */
  for (let i = G.halves.length - 1; i >= 0; i--){
    const h = G.halves[i];
    h.life += dt;
    h.vy += GRAVITY * 0.85 * dt;
    h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.spin * dt;
    if (h.life > h.max || h.y > STAGE_H + OUT_MARGIN) G.halves.splice(i, 1);
  }

  /* 粒子 */
  for (let i = G.parts.length - 1; i >= 0; i--){
    const p = G.parts[i];
    p.life += dt;
    p.vy += GRAVITY * 0.5 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life > p.max) G.parts.splice(i, 1);
  }

  /* 飘分 */
  for (let i = G.floats.length - 1; i >= 0; i--){
    const t = G.floats[i];
    t.life += dt; t.y -= 46 * dt;
    if (t.life > t.max) G.floats.splice(i, 1);
  }

  /* 轨迹光亮：超过 2 秒的消失 */
  while (G.trail.length && G.time - G.trail[0].t > GLOW_LIFE) G.trail.shift();

  G.shake = Math.max(0, G.shake - dt * 55);
  G.flash = Math.max(0, G.flash - dt * 1.9);

  /* HUD */
  updateHud(ph);

  /* 结算 */
  if (G.time >= ROUND_TIME) endRound();
}

/* =========================================================================
 *  8) 渲染
 * ========================================================================= */
function render(){
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  ctx.save();

  if (G.shake > 0.2){
    ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);
  }

  /* 轨迹预览（虚线，帮助玩家预判公式效果） */
  if (G.guide){
    ctx.globalAlpha = 0.8;
    ctx.drawImage(G.guide, 0, 0, STAGE_W, STAGE_H);
    ctx.globalAlpha = 1;
  }

  /* 轨迹光亮：越新越亮，满 2 秒彻底消失 */
  const glowImg = GLOW[G.weapon];
  if (glowImg && G.trail.length){
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < G.trail.length; i++){
      const p = G.trail[i];
      const k = 1 - (G.time - p.t) / GLOW_LIFE;      // 1 → 刚走过，0 → 即将消失
      if (k <= 0) continue;
      const a = Math.pow(k, 1.7);
      const R = 12 + 24 * k;
      ctx.globalAlpha = a * 0.42;
      ctx.drawImage(glowImg, p.x - R, p.y - R, R * 2, R * 2);
      if (k > 0.22){                                  // 近处的再加一圈亮芯
        ctx.globalAlpha = a * 0.85;
        const r2 = (2.4 + 3.4 * k) * 2.2;
        ctx.drawImage(glowImg, p.x - r2, p.y - r2, r2 * 2, r2 * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 水果 / 炸弹 */
  for (const f of G.fruits){
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.ang);
    ctx.shadowColor = f.bomb ? 'rgba(255,60,40,.9)' : 'rgba(0,0,0,.45)';
    ctx.shadowBlur = f.bomb ? 14 : 6;
    ctx.shadowOffsetY = 3;
    drawSpriteAt(f.key, f.size);
    ctx.restore();
  }

  /* 被切开的两半（用半平面裁剪模拟切口） */
  for (const h of G.halves){
    const R = h.size;
    const k = 1 - h.life / h.max;
    ctx.save();
    ctx.globalAlpha = clamp(k * 1.6, 0, 1);
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.beginPath();
    ctx.rotate(h.cutLocal);
    ctx.rect(-R * 2, h.side > 0 ? 0 : -R * 2, R * 4, R * 2);
    ctx.clip();
    ctx.rotate(-h.cutLocal);
    drawSpriteAt(h.key, h.size);
    ctx.restore();
  }

  /* 粒子 */
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts){
    const k = 1 - p.life / p.max;
    ctx.fillStyle = 'rgba(' + p.color + ',' + (k * 0.9).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + k), 0, 6.2832);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  /* 武器 */
  const w = WEAPONS[G.weapon];
  ctx.save();
  ctx.translate(G.curW.x, G.curW.y);
  ctx.rotate(G.wAng);
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  drawSpriteAt(G.weapon, w.len);
  ctx.restore();

  /* 飘分 */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of G.floats){
    const k = 1 - t.life / t.max;
    ctx.font = '900 ' + t.size + 'px system-ui,sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,' + (k * 0.75).toFixed(3) + ')';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = 'rgba(' + t.color + ',' + clamp(k * 1.5, 0, 1).toFixed(3) + ')';
    ctx.fillText(t.text, t.x, t.y);
  }

  ctx.restore();

  /* 爆炸红闪 */
  if (G.flash > 0.01){
    ctx.fillStyle = 'rgba(255,60,30,' + (G.flash * 0.55).toFixed(3) + ')';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}

/* =========================================================================
 *  9) HUD / 界面切换
 * ========================================================================= */
const elScore = $('scoreVal'), elTime = $('timeVal'), elBestHud = $('bestValHud');
const elPhaseFill = $('phaseFill'), elPhaseTip = $('phaseTip');
const elWeaponName = $('weaponNameHud'), elWeaponIcon = $('weaponIconHud');
const formulaInput = $('formulaInput'), formulaMsg = $('formulaMsg'), formulaEq = $('formulaEq');

let lastHudScore = -1, lastHudSec = -1;
function updateHud(ph){
  if (G.score !== lastHudScore){ elScore.textContent = G.score; lastHudScore = G.score; }
  const sec = Math.max(0, Math.ceil(ROUND_TIME - G.time));
  if (sec !== lastHudSec){ elTime.textContent = sec; lastHudSec = sec; }
  elPhaseFill.style.width = (100 * (1 - G.time / ROUND_TIME)).toFixed(1) + '%';
  if (elPhaseTip.textContent !== ph.tip) elPhaseTip.textContent = ph.tip;
}

function showScreen(name){
  G.screen = name;
  screenTitle.classList.toggle('hidden', name !== 'title');
  screenPause.classList.toggle('hidden', name !== 'paused');
  screenResult.classList.toggle('hidden', name !== 'result');
  const inGame = (name === 'playing' || name === 'paused' || name === 'result');
  hud.classList.toggle('hidden', !inGame);
  gameBg.classList.toggle('hidden', !inGame);
  if (!inGame){
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  }
}

let toastTimer = null;
function toast(msg, ms){
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms || 1200);
}

/* --------- 公式应用 --------- */
let presetChips = [];

function applyFormula(src, silent){
  const text = String(src || '').trim();
  if (!text) throw new Error('公式不能为空');
  const path = buildPath(text);
  G.path = path;
  G.speed = clamp(path.total / 2.4, 380, 1500);
  G.startS = nearestS(path);
  // 从“离屏幕正中最近的轨迹点”开始跑，并滑入该点（避免出现在轨迹外）
  G.dist = G.startS;
  G.enterFrom = { x:G.curW.x, y:G.curW.y };
  G.enter = 0;
  G.guide = buildGuide(path);
  formulaEq.textContent = path.parametric ? '(x,y) =' : 'y =';
  if (!silent){
    formulaMsg.className = 'formula-msg ok';
    formulaMsg.textContent = path.parametric
      ? '✓ 参数方程轨迹已套用（t ∈ 0~2π）'
      : '✓ 轨迹已套用';
  }
  presetChips.forEach(c => c.classList.toggle('on', c.dataset.f === text));
  return path;
}

function tryApplyFormula(src){
  try {
    applyFormula(src, false);
  } catch (e){
    formulaMsg.className = 'formula-msg err';
    formulaMsg.textContent = '✗ ' + e.message;
  }
}

function buildGuide(path){
  const c = document.createElement('canvas');
  c.width = STAGE_W * 2; c.height = STAGE_H * 2;
  const g2 = c.getContext('2d');
  g2.scale(2, 2);
  g2.lineCap = 'round';
  g2.lineJoin = 'round';
  g2.beginPath();
  path.pts.forEach((p, i) => i ? g2.lineTo(p.x, p.y) : g2.moveTo(p.x, p.y));
  if (path.closed) g2.closePath();
  // 先描一层暗色让轨迹在明亮背景上也看得见，再叠一层亮色虚线
  g2.setLineDash([]);
  g2.lineWidth = 3.2;
  g2.strokeStyle = 'rgba(0,0,0,.34)';
  g2.stroke();
  g2.setLineDash([5, 8]);
  g2.lineWidth = 1.7;
  g2.strokeStyle = 'rgba(255,255,255,.85)';
  g2.stroke();
  return c;
}

const PRESETS = [
  ['正弦',      'sinx'],
  ['大振幅',    '4sinx'],
  ['密波',      '3sin(6x)'],
  ['抛物线',    '0.5x^2-3'],
  ['直线',      'x'],
  ['圆形',      '2.6cos(t), 2.6sin(t)'],
  ['椭圆',      '2.6cos(t), 4.2sin(t)'],
  ['三瓣玫瑰',  '2.6cos(3t)cos(t), 2.6cos(3t)sin(t)'],
  ['心形',      '3.2sin(t)^3, 2.6cos(t)-1cos(2t)-0.4cos(3t)-0.2cos(4t)'],
  ['螺旋',      '0.45t*cos(t), 0.45t*sin(t)']
];

function buildPresets(){
  const box = $('presets');
  box.innerHTML = '';
  presetChips = PRESETS.map(([label, f]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.textContent = label;
    b.dataset.f = f;
    b.title = f;
    b.addEventListener('click', () => {
      formulaInput.value = f;
      tryApplyFormula(f);
    });
    box.appendChild(b);
    return b;
  });
  presetChips.forEach(c => c.classList.toggle('on', c.dataset.f === formulaInput.value.trim()));
}

/* --------- 掷色子 --------- */
const diceWrap = $('diceWrap'), diceNum = $('diceNum');
const btnRoll = $('btnRoll'), btnStart = $('btnStart');
const startHint = $('startHint'), revealArea = $('revealArea');
const revealImg = $('revealImg'), revealName = $('revealName');

function setWeapon(key){
  G.weapon = key;
  const w = WEAPONS[key];
  elWeaponName.textContent = w.name;
  elWeaponIcon.src = 'images/' + w.icon;
  revealImg.src = 'images/' + w.icon;
  revealName.textContent = w.name;
  revealArea.classList.add('on');
}

function rollDice(){
  if (G.rolling) return;
  G.rolling = true;
  btnRoll.disabled = true;
  btnStart.disabled = true;
  startHint.textContent = '色子旋转中…';
  revealArea.classList.remove('on');
  diceWrap.classList.remove('show-num', 'settling');
  diceWrap.classList.add('rolling');
  diceNum.textContent = '';

  const final = randi(1, 6);
  const cycler = setInterval(() => { diceNum.textContent = String(randi(1, 6)); }, 65);

  setTimeout(() => {
    clearInterval(cycler);
    diceWrap.classList.remove('rolling');
    diceWrap.classList.add('settling');
    diceNum.textContent = String(final);

    setTimeout(() => {
      diceWrap.classList.remove('settling');
      diceWrap.classList.add('show-num');
      const idx = Math.floor((final + 1) / 2) - 1;    // 1,2→0  3,4→1  5,6→2
      G.dice = final;
      G.rolled = true;
      G.rolling = false;
      setWeapon(WEAPON_ORDER[clamp(idx, 0, 2)]);
      btnRoll.disabled = false;
      btnStart.disabled = false;
      startHint.textContent = '掷出 ' + final + ' 点 → 武器：' + WEAPONS[G.weapon].name + '（可重掷）';
      toast('掷出 ' + final + ' 点 · 获得武器：' + WEAPONS[G.weapon].name, 1500);
    }, 720);
  }, 880);
}

/* --------- 开局 / 结算 --------- */
function startRound(){
  G.time = 0; G.score = 0; lastHudScore = -1; lastHudSec = -1;
  G.fruits = []; G.halves = []; G.parts = []; G.floats = []; G.trail = [];
  G.dist = 0; G.enter = 0; G.spawnT = 0.45; G.bombIdx = 0;
  G.fruitHits = 0; G.bombHits = 0; G.shake = 0; G.flash = 0; G.newRecord = false;
  G.paused = false; G.rolling = false;
  G.curW = { x:CX, y:CY }; G.prevW = { x:CX, y:CY }; G.moveAng = -Math.PI / 2;

  try { applyFormula(formulaInput.value, true); }
  catch (e){
    formulaInput.value = 'sinx';
    applyFormula('sinx', true);
  }

  setWeapon(G.weapon);
  elBestHud.textContent = G.best;
  elScore.textContent = '0'; elTime.textContent = ROUND_TIME;
  elPhaseFill.style.width = '100%';
  showScreen('playing');
  render();
}

function endRound(){
  G.newRecord = G.score > G.best;
  if (G.newRecord){ G.best = G.score; saveBest(G.best); }
  $('resultScore').textContent = G.score;
  $('resultBest').textContent = G.best;
  $('resultWeapon').textContent = WEAPONS[G.weapon].name;
  $('resultFruits').textContent = G.fruitHits;
  $('resultBombs').textContent = G.bombHits;
  $('newRecord').classList.toggle('hidden', !G.newRecord);
  $('bestValTitle').textContent = G.best;
  $('bestValHud').textContent = G.best;
  showScreen('result');
}

function backToTitle(){
  if (G.score > G.best){ G.best = G.score; saveBest(G.best); }
  G.score = 0;
  G.fruits = []; G.halves = []; G.parts = []; G.floats = []; G.trail = [];
  $('bestValTitle').textContent = G.best;
  $('bestValHud').textContent = G.best;
  showScreen('title');
}

/* --------- 暂停 --------- */
function pauseGame(){
  if (G.screen !== 'playing' || G.paused) return;
  G.paused = true;
  $('pauseScore').textContent = G.score;
  $('pauseTime').textContent = Math.max(0, Math.ceil(ROUND_TIME - G.time));
  showScreen('paused');
}
function resumeGame(){
  if (G.screen !== 'paused') return;
  G.paused = false;
  showScreen('playing');
}

/* =========================================================================
 *  10) 主循环
 * ========================================================================= */
let lastT = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.05) dt = 0.05;                 // 卡顿保护
  if (G.screen === 'playing' && !G.paused){
    update(dt);
    render();
  }
}

/* =========================================================================
 *  11) 事件绑定与启动
 * ========================================================================= */
function bind(){
  $('btnRoll').addEventListener('click', rollDice);
  $('btnStart').addEventListener('click', () => { if (G.rolled) startRound(); });
  $('btnConfirm').addEventListener('click', () => tryApplyFormula(formulaInput.value));
  formulaInput.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); tryApplyFormula(formulaInput.value); formulaInput.blur(); }
  });
  $('btnSystem').addEventListener('click', pauseGame);
  $('btnResume').addEventListener('click', resumeGame);
  $('btnQuit').addEventListener('click', () => {
    if (G.score > G.best){ G.best = G.score; saveBest(G.best); }
    $('bestValTitle').textContent = G.best;
    G.paused = false;
    backToTitle();
  });
  $('btnAgain').addEventListener('click', () => { G.score = 0; startRound(); });
  $('btnBackTitle').addEventListener('click', () => { G.score = 0; backToTitle(); });

  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape'){
      if (G.screen === 'playing') pauseGame();
      else if (G.screen === 'paused') resumeGame();
    }
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
}

async function init(){
  buildPresets();
  bind();
  resize();
  await loadImages();
  for (const k in WEAPONS) GLOW[k] = makeGlow(WEAPONS[k].glow);

  G.best = loadBest();
  $('bestValTitle').textContent = G.best;
  $('bestValHud').textContent = G.best;

  setWeapon('knife');
  revealArea.classList.remove('on');
  revealName.textContent = '等待掷色子…';
  revealImg.removeAttribute('src');
  try { applyFormula('sinx', true); } catch (e){ console.error(e); }

  $('loading').classList.add('done');
  setTimeout(() => { const l = $('loading'); if (l) l.style.display = 'none'; }, 400);

  showScreen('title');
  requestAnimationFrame(frame);
}

init();
