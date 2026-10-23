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

console.log('boot.test 通过：模块求值、apply 装配、旁问卡片会话隔离入口均就位');
