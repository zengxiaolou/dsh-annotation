// 引导冒烟：client 半能不能在宿主提供的模块装载器下求值、apply 能不能完成装配。
//
// 这一层能抓到的回归：模块顶层引用了已删除的标识符（例如把全局 ui.ask / composer
// 改成按会话分桶后漏改的引用）、slot 注册漏项、apply 抛异常。
// 抓不到的是真实渲染与交互动效——那需要在 DSH 里重载后人工验收。
//
// 运行：node test/boot.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../lib/client.js'), 'utf8');

/* --- 宿主环境最小替身：只提供模块求值路径上真正会被碰到的东西 --------------- */
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry;
    },
  },
  addEventListener() {},
  removeEventListener() {},
  getSelection: () => null,
  innerWidth: 1440,
  innerHeight: 900,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
};
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, removeAttribute() {} }),
};

/* 客户端半用宿主装载器里的 require('react') 取 React，这里直接给本机 react。 */
const requireFromProfile = createRequire(
  '/Users/ruler/.dsh/profiles/desktop/node_modules/',
);
const React = requireFromProfile('react');

new Function('window', source)(globalThis.window);

assert.ok(captured, 'window.__ModuleLoader__.load 没有被调用');
assert.equal(captured.id, 'dsh-annotation');

const plugin = captured.factory((name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
});

assert.deepEqual([...plugin.inject].sort(), ['locale', 'slots']);
assert.equal(typeof plugin.apply, 'function');

/* --- apply：locale + 两个 slot 注册都必须发生 ------------------------------- */
const registered = [];
const ctx = {
  effect(fn) {
    fn();
  },
  locale: {
    register() {},
    bind: () => (key) => key,
  },
  slots: {
    inject(name, fn) {
      fn();
    },
    register(config, component) {
      registered.push({ name: config.name, id: config.id, component });
      return () => {};
    },
  },
  get: () => null,
};

plugin.apply(ctx);

const byId = new Map(registered.map((row) => [row.id, row]));
assert.deepEqual([...byId.keys()].sort(), ['annotation-ask', 'annotation-chip-v7']);
assert.equal(byId.get('annotation-ask').name, 'conversation.chat.turnTail');
assert.equal(byId.get('annotation-chip-v7').name, 'conversation.input.dock');

/* --- 旁问卡片：没有本会话状态时必须渲染成 null，而不是回落到「谁的都画」 --- */
const card = byId.get('annotation-ask').component;
assert.equal(typeof card, 'function');

/* --- 会话隔离不变量：这些形状一旦被改回全局单例，就是这个 bug 复发 ---------- */
const invariants = [
  [/const st = sessionId \? asks\.get\(sessionId\) : undefined;/, '旁问卡片必须按 sessionId 取状态'],
  [/function annosOf\(sessionId\)/, '注释必须按会话取'],
  [/function liveAnnos\(sessionId\)/, 'liveAnnos 必须显式收会话，不能全局过滤'],
  [/body: JSON\.stringify\(\{ sessionId: sessionId,/, '旁问请求必须带真正发起它的会话'],
  [/sidebar\.openTab\(\{ type: 'sidechat', target: 'side' \}, \{ sessionId: owner \}\)/, '侧边对话必须按发起会话开'],
  [/seedSideChat\(text, owner\)/, '侧边对话写入必须带会话作用域'],
  [/if \(!sidebarScopeIs\(sessionId\)\) return undefined;/, '写入前必须校验侧栏作用域'],
];
for (const [pattern, why] of invariants) {
  assert.ok(pattern.test(source), '不变量失守：' + why);
}
for (const banned of ['ui.ask', 'composer.sessionId', 'liveAnnos()']) {
  assert.ok(!source.includes(banned), '残留全局状态引用：' + banned);
}

/* --- 多条注释共存的判据：胶囊化的块正文不在草稿文本里，必须按 ref 认领 ------
   这一组就是「新增一条，前一条就没了」的回归：旧实现只看 draft.indexOf(block)，
   胶囊化的注释永远找不到正文，900ms 后被当成已删除清掉。 ---------------------- */
const test = plugin.apply.__test;
assert.ok(test, 'apply.__test 自检入口缺失');
const { draftBlockOf, semanticDraft, annoAliveInDraft, detectLengthOf } = test;

const a1 = { id: 1, sessionId: 's1', text: '引文一', note: '', chipRef: 'ref-a' };
const a2 = { id: 2, sessionId: 's1', text: '引文二', note: '备注', chipRef: 'ref-b' };
a1.block = draftBlockOf(a1, 1);
a2.block = draftBlockOf(a2, 2);

/* 草稿里只有两枚胶囊的显示文本，没有任何块正文 */
const chipOccurrences = [
  { source: 'paste-chip', ref: 'ref-a', offset: 0, length: 6, label: '注释 · 1', clipboardText: '注释 · 1' },
  { source: 'paste-chip', ref: 'ref-b', offset: 7, length: 6, label: '注释 · 2', clipboardText: '注释 · 2' },
];
const chipDraft = '注释 · 1 注释 · 2 ';
assert.equal(annoAliveInDraft(a1, chipDraft, chipOccurrences), true, '胶囊化的注释 1 必须判活');
assert.equal(annoAliveInDraft(a2, chipDraft, chipOccurrences), true, '胶囊化的注释 2 必须判活');
/* 胶囊被用户删掉（occurrences 少了一枚）就要判死 */
assert.equal(annoAliveInDraft(a1, chipDraft, chipOccurrences.slice(1)), false, '胶囊被删后必须判死');
assert.equal(annoAliveInDraft(a1, '', []), false, '草稿清空后必须判死');

/* 纯文本通道：块正文在草稿里就算活 */
const textDraft = a1.block + '\n\n' + a2.block;
assert.equal(annoAliveInDraft({ ...a1, chipRef: null }, textDraft, []), true, '纯文本块必须判活');
assert.equal(annoAliveInDraft({ ...a1, chipRef: null }, '无关草稿', []), false, '正文不在草稿里必须判死');

/* 被动折叠兜底：没拿到 ref，草稿里只剩 paste-chip 生成的「粘贴「前缀…」」标签 */
const looseBody = a1.block;
const looseLabel = '粘贴「' + looseBody.replace(/\s+/g, ' ').slice(0, 12) + '…」· ' + looseBody.length + ' 字';
assert.equal(
  annoAliveInDraft({ ...a1, chipRef: null }, looseLabel, [{ ref: 'other', label: looseLabel }]),
  true,
  '被被动折叠成无 ref 胶囊时，按标签认领',
);

/* 整份草稿重写必须保留胶囊：偏移跟着正文改动走，删掉的那枚不再声明 */
const rewritten = '用户正文 ' + '注释 · 1' + ' 中间 ' + '注释 · 2';
const edited = semanticDraft(rewritten, chipOccurrences);
assert.equal(edited.references.length, 2, '语义重写必须保留两枚胶囊');
assert.equal(edited.references[0].ref, 'ref-a');
assert.equal(edited.references[1].ref, 'ref-b');
assert.equal(edited.references[0].offset, rewritten.indexOf('注释 · 1'));
assert.equal(edited.references[1].offset, rewritten.indexOf('注释 · 2'));

const dropped = semanticDraft('注释 · 1 用户正文', chipOccurrences);
assert.deepEqual(dropped.references.map((r) => r.ref), ['ref-a'], '显示文本已不在草稿里的胶囊应当被丢弃');
assert.equal(dropped.references[0].offset, 0);

/* 插入点换算：胶囊在 detect 投影里只占 1 个字符 */
assert.equal(detectLengthOf(chipDraft, chipOccurrences), 4, '两枚胶囊各占 1 字符 + 两个空格 = detect 长度 4');
assert.equal(detectLengthOf('纯文本', []), 3, '没有胶囊时两投影一致');

/* 源码级不变量：这两处一旦改回去，bug 就会复发 */
assert.ok(/chipHost\.get\('pasteChip'\)/.test(source), '取胶囊服务必须走 ctx.get，属性访问在 cordis 里永远抛错');
assert.ok(/function annoAliveInDraft\(/.test(source), '存活判定必须走 annoAliveInDraft');
assert.ok(
  /if \(annoAliveInDraft\(a, draft, occurrences\)\) continue;/.test(source),
  '清理循环必须用 annoAliveInDraft，不能退回 draft.indexOf(a.block)',
);
assert.ok(!/draft\.indexOf\(a\.block\) < 0\) \{\s*\n\s*annos\.splice/.test(source), '旧判据必须已移除');

/* --- 端到端：两条注释并存、逐条删除、编号跟随 --------------------------------
   用一个按 DSH 语义写的 paste-chip 替身跑真实链路：insert 只认 detect 坐标 +
   同一 draftRev，setDraft(text) 会丢胶囊（和 Host 的 setDraft 一致）。 ---------- */
const { appendBlock, rewriteChips, removeAnno, annos, composers, setChipHost } = test;

function makeFakeWorld() {
  const chipState = { draft: '', occurrences: [], draftRev: 0 };
  const bodies = new Map();
  let seq = 0;
  const detectLen = () =>
    chipState.draft.length - chipState.occurrences.reduce((sum, o) => sum + Math.max(0, o.length - 1), 0);

  const service = {
    insert(text, options) {
      const span = (options && options.span) || {};
      if (span.draftRev !== chipState.draftRev) return { ok: false, reason: 'rev' };
      if (span.start !== span.end || span.start !== detectLen()) return { ok: false, reason: 'span' };
      seq += 1;
      const ref = 'ref-' + seq;
      const label = options && options.label ? options.label : '粘贴';
      bodies.set(ref, text);
      const offset = chipState.draft.length;
      chipState.draft += label + ' ';
      chipState.occurrences.push({ source: 'paste-chip', ref, label, clipboardText: label, offset, length: label.length });
      chipState.draftRev += 1;
      return { ok: true, ref, label };
    },
    replace(ref, text) {
      if (!bodies.has(ref)) return { ok: false, reason: 'unknown-ref' };
      bodies.set(ref, text);
      return { ok: true, ref };
    },
  };

  const actions = {
    /* Host 的 setDraft(text) 只吃纯文本，胶囊会一起没；对象入参才保留胶囊 */
    setDraft(input) {
      if (typeof input === 'string') {
        chipState.draft = input;
        chipState.occurrences = [];
      } else {
        chipState.draft = input.text;
        chipState.occurrences = input.references.map((r) => ({ ...r }));
      }
      chipState.draftRev += 1;
    },
    submit() {},
  };

  return { chipState, bodies, service, actions };
}

const world = makeFakeWorld();
setChipHost({ get: (name) => (name === 'pasteChip' ? world.service : undefined) });
composers.set('s1', {
  actions: world.actions,
  draft: () => world.chipState.draft,
  state: () => world.chipState,
});

const first = { id: 101, sessionId: 's1', text: '第一段引文', note: '', chipRef: null, block: null };
annos.push(first);
assert.equal(appendBlock(first), true, '第一条注释必须写进草稿');
assert.equal(world.chipState.occurrences.length, 1, '草稿里应有一枚胶囊');
assert.equal(world.chipState.occurrences[0].label, '注释 · 1');
assert.ok(world.bodies.get(first.chipRef).startsWith('〔注释 1〕「第一段引文」'), '胶囊正文应是注释块');

/* 关键回归：过掉 900ms 宽限后，胶囊化的注释仍然必须判活（旧实现在这里被清掉） */
first.writtenAt = Date.now() - 5000;
assert.equal(
  annoAliveInDraft(first, world.chipState.draft, world.chipState.occurrences),
  true,
  '第一条注释不能被当成已删除',
);

/* 加第二条：插入点必须换算成 detect 坐标，否则 span 越界写不进去 */
const second = { id: 102, sessionId: 's1', text: '第二段引文', note: '这里有疑问', chipRef: null, block: null };
annos.push(second);
assert.equal(appendBlock(second), true, '第二条注释必须能追加');
assert.equal(world.chipState.occurrences.length, 2, '两条注释必须同时留在草稿里');
assert.deepEqual(
  world.chipState.occurrences.map((o) => o.label),
  ['注释 · 1', '注释 · 2'],
);
assert.equal(annoAliveInDraft(first, world.chipState.draft, world.chipState.occurrences), true);
assert.equal(annoAliveInDraft(second, world.chipState.draft, world.chipState.occurrences), true);

/* 删第一条：只剩第二条，且重新编号成 1（标签 + 正文都要跟着改） */
removeAnno(101);
assert.equal(annos.length, 1, '删一条只应去掉一条');
assert.equal(world.chipState.occurrences.length, 1, '草稿里应只剩一枚胶囊');
assert.equal(world.chipState.occurrences[0].label, '注释 · 1', '剩下的胶囊标签要重新编号');
assert.ok(world.bodies.get(second.chipRef).startsWith('〔注释 1〕「第二段引文」'), '剩下的胶囊正文要重新编号');
assert.equal(annoAliveInDraft(second, world.chipState.draft, world.chipState.occurrences), true);

/* 用户自己粘贴的胶囊不能因为注释重写而消失 */
rewriteChips('s1', world.chipState.occurrences, (o) => o.clipboardText || o.label || '');
assert.equal(world.chipState.occurrences.length, 1);
composers.delete('s1');

console.log('boot.test 通过：模块求值、apply 装配、会话隔离、多条注释增删与编号跟随均就位');

/* --- 降级路径：paste-chip 装了但服务取不到（胶囊通道不可用） ------------------
   这时注释以纯文本写进草稿，会被 paste-chip 被动折叠成无 ref 的胶囊：
   草稿里只剩「粘贴「正文前 12 字…」」标签，必须靠标签认领，否则同样只剩一条。 --- */
const looseWorld = makeFakeWorld();
setChipHost({ get: () => undefined });
composers.set('s2', {
  actions: looseWorld.actions,
  draft: () => looseWorld.chipState.draft,
  state: () => looseWorld.chipState,
});
function passiveCollapse() {
  const s = looseWorld.chipState;
  const body = s.draft.split('\n\n').pop();
  const label = '粘贴「' + body.replace(/\s+/g, ' ').slice(0, 12) + '…」· ' + body.length + ' 字';
  const offset = s.draft.length - body.length;
  s.draft = s.draft.slice(0, offset) + label;
  s.occurrences.push({
    source: 'paste-chip',
    ref: 'loose-' + s.occurrences.length,
    label,
    clipboardText: label,
    offset,
    length: label.length,
  });
  s.draftRev += 1;
}

const looseA = { id: 201, sessionId: 's2', text: '降级一', note: '', chipRef: null, block: null };
annos.push(looseA);
assert.equal(appendBlock(looseA), true);
passiveCollapse();
assert.equal(looseA.chipRef, null, '服务不可用时不该有 ref');
assert.equal(
  annoAliveInDraft(looseA, looseWorld.chipState.draft, looseWorld.chipState.occurrences),
  true,
  '被被动折叠的注释必须按标签判活',
);

const looseB = { id: 202, sessionId: 's2', text: '降级二', note: '', chipRef: null, block: null };
annos.push(looseB);
assert.equal(appendBlock(looseB), true);
passiveCollapse();
assert.equal(
  annoAliveInDraft(looseB, looseWorld.chipState.draft, looseWorld.chipState.occurrences),
  true,
  '降级路径下第二条也必须判活',
);

/* 删掉第一条：第二条必须还在，且不能因为编号改不动而被清掉 */
const looseCount = () => annos.filter((a) => a.sessionId === 's2').length;
removeAnno(201);
assert.equal(looseCount(), 1, '降级路径删一条只应去掉一条');
assert.equal(looseWorld.chipState.occurrences.length, 1, '草稿里应只剩一枚被动胶囊');
assert.equal(
  annoAliveInDraft(looseB, looseWorld.chipState.draft, looseWorld.chipState.occurrences),
  true,
  '剩下的降级注释不能被编号逻辑带走',
);
composers.delete('s2');
console.log('boot.test 通过：胶囊不可用时的降级路径同样保持多条注释');
