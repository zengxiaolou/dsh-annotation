window.__ModuleLoader__.load({
  id: 'dsh-annotation',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const NS = 'annotation';

    const zh = {
      'chip.many': '{n} 条注释',
      'panel.title': '{n} 条注释',
      'panel.clear': '全部清除',
      'panel.send': '带注释发送',
      'panel.hint': '已写进输入框，可直接改或删',
      'item.delete': '删除第 {n} 条',
      'pop.placeholder': '添加可选评论…',
      'pop.askNew': '旁问',
      'pop.hint': '⏎ 保存 · Esc 取消',
      'pop.save': '保存',
      'pop.cancel': '取消',
      'pop.new': '新建注释',
      'pop.edit': '编辑第 {n} 条',
      'badge.title': '第 {n} 条注释 · 点击编辑',
      'bar.annotate': '注释',
      'bar.side': '侧边对话',
      'bar.ask': '旁问',
      'ask.title': '旁问这段内容',
      'ask.reference': '引用原文',
      'ask.question': '你想了解什么？',
      'ask.cancel': '取消',
      'ask.explain': '解释一下',
      'ask.send': '发送旁问',
      'ask.hint': '引用已固定；其他背景使用发送时主会话已完成的内容。',
      'ask.pending': '正在回答…',
      'ask.diagnose': '侧栏诊断 · 可编辑元素清单',
      'toast.copied': '已复制，粘贴到侧边对话里即可',
      'toast.sideOpened': '已复制，侧边对话已打开（未找到输入框时请手动粘贴）',
    };

    const en = {
      'chip.many': '{n} comments',
      'panel.title': '{n} comments',
      'panel.clear': 'Clear all',
      'panel.send': 'Send with comments',
      'panel.hint': 'Written into your draft — edit or delete freely',
      'item.delete': 'Delete comment {n}',
      'pop.placeholder': 'Add an optional comment…',
      'pop.askNew': 'Side question',
      'pop.hint': '⏎ save · Esc cancel',
      'pop.save': 'Save',
      'pop.cancel': 'Cancel',
      'pop.new': 'New comment',
      'pop.edit': 'Comment {n}',
      'badge.title': 'Comment {n} · click to edit',
      'bar.annotate': 'Comment',
      'bar.side': 'Side chat',
      'bar.ask': 'Side ask',
      'ask.title': 'Ask about this',
      'ask.reference': 'Quoted text',
      'ask.question': 'What would you like to know?',
      'ask.cancel': 'Cancel',
      'ask.explain': 'Explain this',
      'ask.send': 'Send side question',
      'ask.hint': 'The quote is fixed. Other context uses completed main-chat content at send time.',
      'ask.pending': 'Answering…',
      'ask.diagnose': 'Sidebar diagnosis · editable elements',
      'toast.copied': 'Copied — paste it into the side chat',
      'toast.sideOpened': 'Copied — side chat opened (paste manually if the box stayed empty)',
    };

    /* ------------------------------------------------------------------ store */

    let uid = 0;
    const annos = [];
    const subs = new Set();

    const ui = {
      bar: null,
      toast: '',
      ask: null,
      open: false,
      editingId: null,
      note: '',
      html: '',
      text: '',
      anchor: null,
    };

    let hostCtx = null;
    let toastTimer = 0;

    function toast(text) {
      ui.toast = text;
      emit();
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        ui.toast = '';
        emit();
      }, 2600);
    }

    let translate = (key, vars) =>
      String(key).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

    function emit() {
      subs.forEach((fn) => {
        try {
          fn();
        } catch (err) {
          /* one listener must never break the rest */
        }
      });
    }

    function subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }

    function useTick() {
      const [tick, setTick] = useState(0);
      useEffect(() => subscribe(() => setTick((v) => v + 1)), []);
      return tick;
    }

    /* --------------------------------------------------------------- anchoring */

    const BLOCK_SELECTOR = 'p,li,pre,blockquote,td,th,h1,h2,h3,h4,h5,h6';

    function blockOf(node) {
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el || !el.closest) return null;
      return el.closest(BLOCK_SELECTOR) || el;
    }

    function offsetIn(block, node, offset) {
      if (!block || !node) return -1;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      let total = 0;
      let cur;
      while ((cur = walker.nextNode())) {
        if (cur === node) return total + offset;
        total += cur.nodeValue.length;
      }
      return -1;
    }

    function rangeFromOffsets(block, start, end) {
      if (!block || start < 0 || end <= start) return null;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      let total = 0;
      let node;
      let sNode = null;
      let sOff = 0;
      let eNode = null;
      let eOff = 0;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (sNode === null && start <= total + len) {
          sNode = node;
          sOff = start - total;
        }
        if (end <= total + len) {
          eNode = node;
          eOff = end - total;
          break;
        }
        total += len;
      }
      if (!sNode || !eNode) return null;
      const range = document.createRange();
      try {
        range.setStart(sNode, Math.max(0, Math.min(sOff, sNode.nodeValue.length)));
        range.setEnd(eNode, Math.max(0, Math.min(eOff, eNode.nodeValue.length)));
      } catch (err) {
        return null;
      }
      return range;
    }

    function findByText(raw, tag) {
      if (!raw || raw.length < 2) return null;
      const blocks = document.querySelectorAll(BLOCK_SELECTOR);
      let weak = null;
      for (const el of blocks) {
        const content = el.textContent || '';
        const idx = content.indexOf(raw);
        if (idx < 0) continue;
        if (tag && el.tagName !== tag) {
          if (!weak) weak = { el: el, idx: idx };
          continue;
        }
        const range = rangeFromOffsets(el, idx, idx + raw.length);
        if (range) return range;
      }
      if (weak) return rangeFromOffsets(weak.el, weak.idx, weak.idx + raw.length);
      return null;
    }

    function makeAnchor(range) {
      const block = blockOf(range.startContainer);
      const start = block ? offsetIn(block, range.startContainer, range.startOffset) : -1;
      const end = block ? offsetIn(block, range.endContainer, range.endOffset) : -1;
      return {
        block: block,
        start: start,
        end: end,
        tag: block ? block.tagName : null,
        raw: range.toString(),
      };
    }

    /** Resolve an annotation back to a live Range, surviving message re-renders. */
    function resolveRange(a) {
      if (a.range) {
        const sc = a.range.startContainer;
        if (sc && sc.isConnected) return a.range;
        a.range = null;
      }
      if (a.block && a.block.isConnected) {
        const rebuilt = rangeFromOffsets(a.block, a.start, a.end);
        if (rebuilt) {
          a.range = rebuilt;
          return rebuilt;
        }
      }
      const found = findByText(a.raw, a.tag);
      if (found) {
        a.range = found;
        a.block = blockOf(found.startContainer);
        a.start = offsetIn(a.block, found.startContainer, found.startOffset);
        a.end = offsetIn(a.block, found.endContainer, found.endOffset);
        return found;
      }
      return null;
    }

    function usableRects(range) {
      if (!range) return [];
      let rects = [];
      try {
        rects = Array.from(range.getClientRects());
      } catch (err) {
        return [];
      }
      return rects.filter((r) => r.width > 0.5 && r.height > 0.5);
    }

    function liveAnnos() {
      return annos.filter((a) => usableRects(resolveRange(a)).length > 0);
    }

    /* --------------------------------------------------------------- selection */

    const ALLOWED = new Set(['CODE', 'STRONG', 'B', 'EM', 'I', 'SPAN', 'BR']);

    function sanitizeHtml(html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const walk = (node) => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 3) continue;
          if (child.nodeType !== 1) {
            child.remove();
            continue;
          }
          if (!ALLOWED.has(child.tagName)) {
            child.replaceWith(document.createTextNode(child.textContent || ''));
            continue;
          }
          for (const attr of Array.from(child.attributes)) {
            if (attr.name !== 'class') child.removeAttribute(attr.name);
          }
          walk(child);
        }
      };
      walk(tpl.content);
      return tpl.innerHTML;
    }

    function captureFromRange(range) {
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      return {
        html: sanitizeHtml(holder.innerHTML),
        text: (range.toString() || '').replace(/\s+/g, ' ').trim(),
      };
    }

    function isEditable(node) {
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el || !el.closest) return false;
      return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    }

    function currentSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!range.toString().trim()) return null;
      if (isEditable(range.commonAncestorContainer)) return null;
      return range;
    }

    function showBarForSelection() {
      const range = currentSelection();
      if (!range) return false;
      const captured = captureFromRange(range);
      if (!captured.text) return false;
      const rects = usableRects(range);
      if (!rects.length) return false;
      ui.bar = {
        range: range,
        rects: rects,
        end: rects[rects.length - 1],
        html: captured.html,
        text: captured.text,
        anchor: makeAnchor(range),
        at: Date.now(),
      };
      emit();
      return true;
    }

    /**
     * 把文本灌进侧边对话的输入框。
     * better-sidebar 的线程编辑器是 Lexical，没有对外接口，只能按 DOM 找：
     * 侧栏里那个 class 带 sidechat 的 contenteditable。
     */
    /** 侧边对话写不进去时，把现场证据摆出来，而不是继续盲猜。 */
    function diagnoseEditors() {
      const rows = Array.from(document.querySelectorAll('[contenteditable]')).map((el, i) => {
        const rect = el.getBoundingClientRect();
        const chain = [];
        let node = el;
        for (let depth = 0; depth < 4 && node; depth += 1) {
          const cls = typeof node.className === 'string' ? node.className : '';
          if (cls) chain.push(cls.split(' ')[0].slice(0, 28));
          node = node.parentElement;
        }
        return (
          '#' + (i + 1) +
          ' x=' + Math.round(rect.left) + ' y=' + Math.round(rect.top) +
          ' w=' + Math.round(rect.width) +
          ' editable="' + (el.getAttribute('contenteditable') || '') + '"' +
          ' class="' + (typeof el.className === 'string' ? el.className.slice(0, 40) : '') + '"' +
          ' up=[' + chain.join(' < ') + ']'
        );
      });
      return rows.length ? rows.join('\n') : '页面上没有任何 contenteditable';
    }

    function seedSideChat(text) {
      if (!text) return () => {};
      let disposed = false;
      let observer = null;
      let cap = 0;

      const pick = () =>
        Array.from(document.querySelectorAll('[contenteditable="true"]'))
          .map((el) => ({ el: el, rect: el.getBoundingClientRect() }))
          .filter((item) => item.rect.width > 120 && item.rect.height > 20 && item.rect.left > window.innerWidth * 0.45)
          .sort((a, b) => b.rect.left - a.rect.left)[0];

      const write = (editor) => {
        try {
          editor.focus();
          const sel = window.getSelection();
          sel.selectAllChildren(editor);
          sel.collapseToEnd();
        } catch (err) {
          /* 选区拿不到也继续尝试写入 */
        }
        try {
          document.execCommand('insertText', false, text);
        } catch (err) {
          /* 命令被拒就走 paste */
        }
        if (!(editor.textContent || '').trim()) {
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
          } catch (err) {
            /* 两条都不行时剪贴板里还有 */
          }
        }
        return (editor.textContent || '').trim().length > 0;
      };

      const stop = () => {
        disposed = true;
        if (observer) observer.disconnect();
        if (cap) window.clearTimeout(cap);
      };

      const attempt = () => {
        if (disposed) return true;
        const hit = pick();
        if (!hit) return false;
        if (write(hit.el)) {
          stop();
          return true;
        }
        return false;
      };

      if (attempt()) return stop;

      /* 输入框通常是「创建线程 → 挂载编辑器」之后才出现，所以监听 DOM 变化，
         一旦出现就写，而不是盲等固定时长。 */
      observer = new MutationObserver(() => {
        attempt();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      cap = window.setTimeout(() => {
        stop();
        ui.ask = {
          phase: 'done',
          question: translate('ask.diagnose'),
          quote: '',
          showQuote: false,
          text: diagnoseEditors(),
          error: '',
        };
        emit();
      }, 15000);
      return stop;
    }

    function openAsk(quote) {
      ui.ask = { phase: 'asking', quote: quote || '', question: '', showQuote: false, text: '', error: '' };
      ui.bar = null;
      emit();
    }

    function askQuestion(question) {
      const state = ui.ask;
      if (!state) return;
      const q = String(question || '').trim();
      if (!q) return;
      ui.ask = { phase: 'pending', quote: state.quote, question: q, showQuote: state.showQuote, text: '', error: '' };
      emit();
      fetch('/dsh-annotation/ask', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: composer.sessionId, quote: state.quote, question: q }),
      })
        .then((res) => {
          if (!res.body || !res.body.getReader) return res.json().then((d) => ({ whole: d }));
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let final = '';
          const pump = () =>
            reader.read().then(({ done, value }) => {
              if (value) buffer += decoder.decode(value, { stream: true });
              let at = buffer.indexOf('\n');
              while (at >= 0) {
                const line = buffer.slice(0, at).trim();
                buffer = buffer.slice(at + 1);
                if (line) {
                  try {
                    const frame = JSON.parse(line);
                    if (frame.delta) {
                      ui.ask.text += frame.delta;
                      emit();
                    } else if (frame.done) {
                      final = String(frame.text || ui.ask.text || '');
                    } else if (frame.error) {
                      ui.ask.error = String(frame.error);
                    }
                  } catch (err) {
                    /* 半个帧留到下一轮再解 */
                  }
                }
                at = buffer.indexOf('\n');
              }
              if (done) return { final: final };
              return pump();
            });
          return pump();
        })
        .then((res) => {
          if (!ui.ask) return;
          const whole = res && res.whole;
          if (whole) {
            ui.ask.text = String(whole.text || ui.ask.text || '');
            if (!whole.ok) ui.ask.error = String(whole.error || '旁问失败');
          }
          if (!ui.ask.text && !ui.ask.error) ui.ask.error = '模型没有返回文字回答。';
          ui.ask.phase = 'done';
          emit();
        })
        .catch((err) => {
          if (!ui.ask) return;
          ui.ask.phase = 'done';
          ui.ask.error = String((err && err.message) || err);
          emit();
        });
    }

    function closePopover() {
      if (!ui.open) return;
      ui.open = false;
      ui.editingId = null;
      ui.note = '';
      ui.html = '';
      ui.text = '';
      ui.anchor = null;
      emit();
    }

    function commitAnnotation() {
      const note = ui.note.trim();
      if (ui.editingId != null) {
        const target = annos.find((a) => a.id === ui.editingId);
        if (target) {
          target.note = note;
          replaceBlock(target);
          emit();
        }
      } else if (ui.anchor) {
        const created = {
          id: ++uid,
          range: ui.anchor.range,
          block: ui.anchor.block,
          start: ui.anchor.start,
          end: ui.anchor.end,
          tag: ui.anchor.tag,
          raw: ui.anchor.raw,
          html: ui.html,
          text: ui.text,
          note: note,
        };
        annos.push(created);
        appendBlock(created);
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      }
      closePopover();
    }

    function removeAnno(id) {
      const at = annos.findIndex((a) => a.id === id);
      if (at >= 0) {
        removeBlock(annos[at]);
        annos.splice(at, 1);
        renumberBlocks();
      }
      emit();
    }

    /* ---------------------------------------------------------------- payload */

    function esc(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function buildPayload(list) {
      const items = list || annos;
      if (!items.length) return '';
      const lines = ['<annotations count="' + items.length + '">'];
      items.forEach((a, i) => {
        lines.push(
          '  <annotation n="' + (i + 1) + '"' + (a.note ? ' note="' + esc(a.note) + '"' : '') + '>' +
            esc(a.text) +
            '</annotation>',
        );
      });
      lines.push('</annotations>');
      return lines.join('\n');
    }

    /* ------------------------------------------------------- draft coupling */

    /**
     * The comments live in the composer text itself: one Markdown blockquote per
     * comment. No submit interception, no button guessing — whatever the user
     * sends carries them, and they stay editable and deletable like normal text.
     */
    const composer = { actions: null, draft: () => '' };

    function draftBlockOf(a, n) {
      return '〔注释 ' + n + '〕「' + a.text + '」' + (a.note ? '｜备注：' + a.note : '');
    }

    function writeDraft(next) {
      const actions = composer.actions;
      if (!actions || !actions.setDraft) return false;
      try {
        actions.setDraft(next);
        return true;
      } catch (err) {
        return false;
      }
    }

    function currentDraft() {
      try {
        return composer.draft() || '';
      } catch (err) {
        return '';
      }
    }

    function appendBlock(a) {
      const draft = currentDraft();
      const n = annos.indexOf(a) + 1;
      const block = draftBlockOf(a, n);
      a.block = block;
      a.writtenAt = Date.now();
      return writeDraft(draft ? draft + '\n\n' + block : block);
    }

    function replaceBlock(a) {
      const draft = currentDraft();
      const n = annos.indexOf(a) + 1;
      const next = draftBlockOf(a, n);
      const prev = a.block;
      a.block = next;
      if (!prev || draft.indexOf(prev) < 0) return writeDraft(draft ? draft + '\n\n' + next : next);
      return writeDraft(draft.replace(prev, next));
    }

    function removeBlock(a) {
      const draft = currentDraft();
      const prev = a.block;
      a.block = null;
      if (!prev || draft.indexOf(prev) < 0) return;
      writeDraft(draft.replace(prev, '').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, ''));
    }

    /** Renumber every queued block after a deletion, rewriting them in place. */
    function renumberBlocks() {
      const draft = currentDraft();
      let next = draft;
      let changed = false;
      annos.forEach((a, i) => {
        const fresh = draftBlockOf(a, i + 1);
        const prev = a.block;
        if (prev && prev !== fresh && next.indexOf(prev) >= 0) {
          next = next.replace(prev, fresh);
          changed = true;
        }
        a.block = fresh;
      });
      if (changed) writeDraft(next);
    }

    /* ----------------------------------------------------------------- styles */

    const css =
      '.anno-hl{position:fixed;border-radius:3px;pointer-events:none;z-index:1;' +
      'background:rgba(47,107,237,.26);}' +
      '.anno-hl[data-ghost="1"]{background:rgba(47,107,237,.34);' +
      'box-shadow:0 0 0 1px rgba(47,107,237,.5);}' +
      '.anno-bar{position:fixed;pointer-events:auto;z-index:82;display:flex;align-items:center;gap:2px;padding:3px;' +
      'border-radius:10px;border:1px solid var(--dsw-alias-border-l2);' +
      'background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #2b2e34) 58%, #000);' +
      'box-shadow:0 14px 34px rgba(0,0,0,.5);}' +
      '.anno-bar-btn{border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;' +
      'height:26px;padding:0 10px;border-radius:7px;cursor:pointer;white-space:nowrap;}' +
      '.anno-bar-btn:hover{background:rgba(255,255,255,.08);}' +
      '.anno-err{position:fixed;left:12px;bottom:12px;z-index:90;padding:6px 10px;border-radius:8px;' +
      'background:#5c1d1d;color:#ffd7d7;font-size:11.5px;max-width:60vw;}' +
      '.anno-ask-mask{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.38);display:flex;' +
      'align-items:center;justify-content:center;pointer-events:auto;}' +
      '.anno-ask-modal{box-sizing:border-box;width:min(560px,92vw);max-height:80vh;overflow:auto;border-radius:12px;' +
      'padding:18px 20px;border:1px solid rgba(255,255,255,.09);' +
      'background:color-mix(in srgb, var(--dsw-alias-bg-layer-1, #26282d) 88%, #000);' +
      'box-shadow:0 24px 60px rgba(0,0,0,.55);color:var(--dsw-alias-label-primary);}' +
      '.anno-ask-modal *{box-sizing:border-box;}' +
      '.anno-ask-title{font-size:17px;font-weight:600;margin-bottom:12px;}' +
      '.anno-ask-quote-toggle{border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;' +
      'cursor:pointer;padding:2px 0;text-align:left;}' +
      '.anno-ask-quote{border-left:2px solid var(--dsw-alias-border-l2);padding:4px 0 4px 10px;margin:4px 0 8px;' +
      'font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary);max-height:34vh;overflow:auto;white-space:pre-wrap;}' +
      '.anno-ask-q{font-size:13.5px;color:var(--dsw-alias-label-secondary);margin:10px 0 8px;}' +
      '.anno-ask-input{display:block;width:100%;min-height:110px;resize:vertical;border-radius:10px;padding:10px 12px;' +
      'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:var(--dsw-alias-label-primary);' +
      'font:inherit;font-size:14px;line-height:1.6;outline:none;}' +
      '.anno-ask-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary);}' +
      '.anno-ask-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:8px 0 14px;}' +
      '.anno-ask-actions{display:flex;justify-content:flex-end;gap:8px;}' +
      '.anno-ask-btn{height:32px;padding:0 16px;border-radius:8px;border:1px solid rgba(255,255,255,.16);' +
      'background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;}' +
      '.anno-ask-btn:hover{background:rgba(255,255,255,.06);}' +
      '.anno-ask-btn.primary{background:#e9e9ef;border-color:transparent;color:#16181c;font-weight:600;}' +
      '.anno-ask-btn.primary:hover{background:#f4f4f8;}' +
      '.anno-ask-card{margin:10px 0;border-radius:12px;' +
      'border:1px solid rgba(255,255,255,.09);' +
      'background:color-mix(in srgb, var(--dsw-alias-bg-layer-1, #26282d) 88%, #000);' +
      'padding:12px 14px;color:var(--dsw-alias-label-primary);}' +
      '.anno-ask-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13.5px;font-weight:600;}' +
      '.anno-ask-x{border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;}' +
      '.anno-ask-body{margin-top:8px;font-size:13px;line-height:1.75;white-space:pre-wrap;max-height:40vh;overflow:auto;}' +
      '.anno-ask-pending{color:var(--dsw-alias-label-secondary);}' +
      '.anno-ask-error{color:var(--dsw-alias-state-error-primary);}' +
      '.anno-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:85;padding:7px 14px;' +
      'border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #2b2e34) 58%, #000);' +
      'border:1px solid var(--dsw-alias-border-l2);' +
      'color:var(--dsw-alias-label-primary);font-size:12.5px;box-shadow:0 12px 30px rgba(0,0,0,.3);}' +
      '.anno-badge{position:fixed;pointer-events:auto;z-index:3;width:18px;height:18px;padding:0;border:0;border-radius:9px;' +
      'background:#2f6bed;color:#fff;font-size:10.5px;font-weight:600;line-height:18px;' +
      'text-align:center;cursor:pointer;box-shadow:0 0 0 2px var(--dsw-alias-bg-base),0 3px 10px rgba(0,0,0,.35);}' +
      '.anno-badge:hover{filter:brightness(1.12);}' +
      '.anno-pop{position:fixed;pointer-events:auto;z-index:80;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);' +
      'background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #2b2e34) 58%, #000);box-shadow:0 18px 44px rgba(0,0,0,.5);padding:9px 11px 8px;}' +
      '.anno-pop input{width:100%;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);' +
      'font:inherit;font-size:13.5px;padding:5px 1px;}' +
      '.anno-pop input::placeholder{color:var(--dsw-alias-label-secondary);}' +
      '.anno-pop-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
      'color:var(--dsw-alias-label-secondary);font-size:11px;padding:3px 1px 0;}' +
      '.anno-btn{border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;' +
      'color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;height:24px;padding:0 11px;cursor:pointer;}' +
      '.anno-btn:hover{color:var(--dsw-alias-label-primary);}' +
      '.anno-btn.primary{background:#2f6bed;border-color:transparent;color:#fff;}' +
      '.anno-btn.primary:hover{filter:brightness(1.1);}' +
      '.anno-pop-actions{display:flex;align-items:center;gap:6px;}' +
      '.anno-pop-badge{position:absolute;right:-9px;bottom:-9px;width:22px;height:22px;border-radius:11px;' +
      'background:#2f6bed;color:#fff;font-size:11px;font-weight:600;line-height:22px;' +
      'text-align:center;box-shadow:0 0 0 3px var(--dsw-alias-bg-base);}' +
      '.anno-chip-wrap{position:relative;display:flex;justify-content:flex-start;align-items:center;}' +
      '.anno-chip{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;' +
      'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);' +
      'color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;}' +
      '.anno-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}' +
      '.anno-card{position:absolute;bottom:100%;left:0;margin-bottom:8px;width:340px;max-width:80vw;z-index:70;' +
      'opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s ease;' +
      'border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;' +
      'background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #2b2e34) 58%, #000);}' +
      '.anno-chip-wrap:hover .anno-card,.anno-chip-wrap.anno-pinned .anno-card{opacity:1;visibility:visible;pointer-events:auto;}' +
      '.anno-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;' +
      'color:var(--dsw-alias-label-secondary);font-size:12px;border-bottom:.5px solid var(--dsw-alias-border-l2);}' +
      '.anno-card-clear{border:0;background:none;color:inherit;font:inherit;font-size:11.5px;cursor:pointer;padding:2px 4px;border-radius:6px;}' +
      '.anno-card-item{display:grid;grid-template-columns:16px 1fr auto;gap:8px;align-items:start;padding:8px 12px;cursor:pointer;}' +
      '.anno-card-item:hover{background:rgba(255,255,255,.04);}' +
      '.anno-card-body{min-width:0;}' +
      '.anno-inline{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:999px;' +
      'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);' +
      'color:var(--dsw-alias-label-primary);font-size:12px;}' +
      '.anno-inline-x{border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;padding:0 2px;}' +
      '.anno-inline-x:hover{color:var(--dsw-alias-state-error-primary);}' +
      '.anno-panel{position:fixed;z-index:75;width:400px;max-width:calc(100vw - 32px);border-radius:12px;' +
      'border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #2b2e34) 58%, #000);' +
      'box-shadow:0 20px 44px rgba(0,0,0,.5);overflow:hidden;}' +
      '.anno-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;' +
      'border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;}' +
      '.anno-panel-head button{border:0;background:none;color:inherit;font:inherit;font-size:11.5px;cursor:pointer;padding:2px 4px;border-radius:6px;}' +
      '.anno-panel-head button:hover{color:var(--dsw-alias-state-error-primary);}' +
      '.anno-panel-body{max-height:228px;overflow:auto;}' +
      '.anno-item{display:grid;grid-template-columns:16px 1fr auto;gap:8px;align-items:start;padding:8px 12px;' +
      'border-bottom:.5px solid var(--dsw-alias-border-l1);cursor:pointer;}' +
      '.anno-item:last-child{border-bottom:0;}' +
      '.anno-item:hover{background:var(--dsw-alias-bg-layer-2);}' +
      '.anno-item-idx{color:#4d86ff;font-size:11.5px;font-weight:600;line-height:1.6;}' +
      '.anno-item-quote{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}' +
      '.anno-item-quote code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;' +
      'background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 3px;}' +
      '.anno-item-note{color:var(--dsw-alias-label-secondary);font-size:11.5px;margin-top:2px;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}' +
      '.anno-item-del{border:0;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;' +
      'cursor:pointer;padding:0 2px;line-height:1.5;}' +
      '.anno-item-del:hover{color:var(--dsw-alias-state-error-primary);}' +
      '.anno-panel-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;' +
      'border-top:.5px solid var(--dsw-alias-border-l2);}' +
      '.anno-panel-foot span{color:var(--dsw-alias-label-secondary);font-size:11px;}' +
      '.anno-send{height:26px;padding:0 12px;border-radius:999px;border:0;cursor:pointer;' +
      'background:#2f6bed;color:#fff;font:inherit;font-size:12px;}' +
      '.anno-send:hover{filter:brightness(1.1);}';

    /* ------------------------------------------------------------------ layer */

    function AnnoLayer() {
      useTick();
      const [boxes, setBoxes] = useState([]);
      const popRef = useRef(null);
      const barRef = useRef(null);
      const inputRef = useRef(null);
      const rafRef = useRef(0);
      const sigRef = useRef('');

      const measure = useCallback(() => {
        const next = [];
        annos.forEach((a, i) => {
          const rects = usableRects(resolveRange(a));
          if (!rects.length) return;
          next.push({ id: a.id, index: i + 1, rects: rects, end: rects[rects.length - 1] });
        });
        if (ui.bar && ui.bar.range) {
          const barRects = usableRects(ui.bar.range);
          if (barRects.length) {
            ui.bar.rects = barRects;
            ui.bar.end = barRects[barRects.length - 1];
          }
        }
        if (ui.open && ui.anchor) {
          const rects = ui.anchor.range ? usableRects(ui.anchor.range) : ui.anchor.rects;
          if (rects && rects.length) {
            ui.anchor.rects = rects;
            ui.anchor.end = rects[rects.length - 1];
            next.push({ ghost: true, id: 'ghost', index: null, rects: rects, end: ui.anchor.end });
          }
        }
        const sig = next
          .map((b) =>
            b.id +
            ':' +
            b.rects
              .map((r) => Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height))
              .join('|'),
          )
          .join(';');
        if (sigRef.current === sig) return;
        sigRef.current = sig;
        setBoxes(next);
      }, []);

      useEffect(() => {
        const schedule = () => {
          if (rafRef.current) return;
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            measure();
          });
        };
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        /* 状态变化（新增/删除注释）立即重绘，不要等 rAF；滚动仍走 schedule */
        const off = subscribe(() => measure());
        schedule();
        return () => {
          window.removeEventListener('scroll', schedule, true);
          window.removeEventListener('resize', schedule);
          off();
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
      }, [measure]);

      useEffect(() => {
        const onUp = (ev) => {
          const target = ev.target;
          if (popRef.current && popRef.current.contains(target)) return;
          if (target && target.closest && target.closest('[data-anno-badge]')) return;
          window.setTimeout(() => {
            if (ui.bar || ui.open) return;
            showBarForSelection();
          }, 0);
        };
        document.addEventListener('mouseup', onUp, true);
        return () => document.removeEventListener('mouseup', onUp, true);
      }, []);

      /* Selection can settle without a usable mouseup (editor swallows it,
         drag inside a widget). Watch the selection itself as the primary
         trigger and keep mouseup as the fast path. */
      useEffect(() => {
        let timer = 0;
        const onSelectionChange = () => {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (ui.bar || ui.open) return;
            showBarForSelection();
          }, 220);
        };
        document.addEventListener('selectionchange', onSelectionChange);
        return () => {
          document.removeEventListener('selectionchange', onSelectionChange);
          if (timer) window.clearTimeout(timer);
        };
      }, []);

      /* 备注框里的回车必须由我们先接：window 捕获阶段早于任何 document 监听，
         否则会被宿主的键盘处理抢走（表现为「回车没反应」）。 */
      useEffect(() => {
        const onKeyCapture = (ev) => {
          if (!ui.open) return;
          const target = ev.target;
          if (!popRef.current || !popRef.current.contains(target)) return;
          if (ev.isComposing || (ev.nativeEvent && ev.nativeEvent.isComposing)) return;
          if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            commitAnnotation();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            closePopover();
          }
        };
        window.addEventListener('keydown', onKeyCapture, true);
        return () => window.removeEventListener('keydown', onKeyCapture, true);
      }, []);

      useEffect(() => {
        const onDown = (ev) => {
          if (popRef.current && popRef.current.contains(ev.target)) return;
          if (barRef.current && barRef.current.contains(ev.target)) return;
          /* a stray mousedown right after the selection must not dismiss the bar */
          if (ui.bar && ui.bar.at && Date.now() - ui.bar.at < 300) return;
          if (ui.bar) {
            ui.bar = null;
            emit();
          }
          if (ui.open) closePopover();
        };
        const onKey = (ev) => {
          if (ev.key === 'Escape') closePopover();
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, []);

      const openEditor = (annoId) => {
        const target = annos.find((a) => a.id === annoId);
        if (!target) return;
        const range = resolveRange(target);
        const rects = usableRects(range);
        if (!rects.length) return;
        ui.open = true;
        ui.editingId = target.id;
        ui.note = target.note || '';
        ui.html = target.html;
        ui.text = target.text;
        ui.anchor = { range: range, rects: rects, end: rects[rects.length - 1] };
        emit();
        window.setTimeout(() => {
          if (inputRef.current) inputRef.current.focus();
        }, 20);
      };

      const openFromBar = () => {
        const bar = ui.bar;
        if (!bar) return;
        ui.bar = null;
        ui.open = true;
        ui.editingId = null;
        ui.note = '';
        ui.html = bar.html;
        ui.text = bar.text;
        ui.anchor = Object.assign({}, bar.anchor, { range: bar.range, rects: bar.rects, end: bar.end });
        emit();
        window.setTimeout(() => {
          if (inputRef.current) inputRef.current.focus();
        }, 20);
      };

      const sendToSide = () => {
        const bar = ui.bar;
        if (!bar) return;
        const payload = buildPayload(liveAnnos());
        const text = bar.text + (payload ? '\n\n' + payload : '');
        ui.bar = null;
        emit();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        } catch (err) {
          /* 剪贴板被拒也不影响开标签页 */
        }
        /* 侧边对话是 better-sidebar 的 tab：直接开一个 sidechat 标签（它自己 mint 线程） */
        let opened = false;
        try {
          const sidebar = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('betterSidebar') : null;
          if (sidebar && typeof sidebar.openTab === 'function') {
            sidebar.openTab({ type: 'sidechat', target: 'side' }, { sessionId: composer.sessionId });
            opened = true;
            seedSideChat(text);
          }
        } catch (err) {
          opened = false;
        }
        if (!opened) {
          try {
            if (hostCtx && hostCtx.layout) hostCtx.layout.openRightbar(true, false);
          } catch (err) {
            /* 打开右栏也是尽力而为 */
          }
        }
        toast(opened ? translate('toast.sideOpened') : translate('toast.copied'));
      };

      let children;
      try {
        children = buildChildren();
      } catch (err) {
        return h('div', { className: 'anno-err' }, 'anno: ' + (err && err.message ? err.message : String(err)));
      }

      function buildChildren() {
      const out = [h('style', { key: 'css' }, css)];

      if (ui.bar && !ui.open) {
        const end = ui.bar.end;
        const barWidth = 224;
        const barLeft = Math.max(12, Math.min(end.left - 6, window.innerWidth - barWidth - 12));
        /* 另一条选中工具栏（btw）停在选区上方，这里固定落在下方，两者不重叠 */
        const barStyle = { left: barLeft + 'px', top: end.bottom + 12 + 'px' };
        const pick = (fn) => (ev) => {
          ev.stopPropagation();
          fn();
        };
        out.push(
          h(
            'div',
            { key: 'bar', ref: barRef, className: 'anno-bar', style: barStyle, onMouseDown: (ev) => ev.stopPropagation() },
            h(
              'button',
              { type: 'button', className: 'anno-bar-btn', onMouseDown: (ev) => ev.preventDefault(), onClick: pick(openFromBar) },
              translate('bar.annotate'),
            ),
            h(
              'button',
              { type: 'button', className: 'anno-bar-btn', onMouseDown: (ev) => ev.preventDefault(), onClick: pick(sendToSide) },
              translate('bar.side'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'anno-bar-btn',
                onMouseDown: (ev) => ev.preventDefault(),
                onClick: pick(() => {
                  const bar = ui.bar;
                  if (!bar) return;
                  const queued = liveAnnos();
                  const notes = queued.map((a) => '〔注释〕' + a.text + (a.note ? '｜' + a.note : '')).join('\n');
                  openAsk(notes ? bar.text + '\n' + notes : bar.text);
                }),
              },
              translate('bar.ask'),
            ),
          ),
        );
      }

      if (ui.ask && ui.ask.phase === 'asking') {
        const st = ui.ask;
        out.push(
          h('div', { key: 'ask-modal', className: 'anno-ask-mask', onMouseDown: (ev) => ev.stopPropagation() },
            h('div', { className: 'anno-ask-modal' },
              h('div', { className: 'anno-ask-title' }, translate('ask.title')),
              h('button', {
                type: 'button',
                className: 'anno-ask-quote-toggle',
                onClick: () => { st.showQuote = !st.showQuote; emit(); },
              }, (st.showQuote ? '▾ ' : '▸ ') + translate('ask.reference') + ' · ' + st.quote.length),
              st.showQuote
                ? h('div', { className: 'anno-ask-quote' }, st.quote)
                : null,
              h('div', { className: 'anno-ask-q' }, translate('ask.question')),
              h('textarea', {
                className: 'anno-ask-input',
                autoFocus: true,
                value: st.question,
                placeholder: '',
                onInput: (ev) => { st.question = ev.target.value; },
                onKeyDown: (ev) => {
                  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
                    ev.preventDefault();
                    askQuestion(st.question);
                  }
                },
              }),
              h('div', { className: 'anno-ask-hint' }, translate('ask.hint')),
              h('div', { className: 'anno-ask-actions' },
                h('button', {
                  type: 'button',
                  className: 'anno-ask-btn',
                  onClick: () => { ui.ask = null; emit(); },
                }, translate('ask.cancel')),
                h('button', {
                  type: 'button',
                  className: 'anno-ask-btn',
                  onClick: () => askQuestion('解释一下这段内容'),
                }, translate('ask.explain')),
                h('button', {
                  type: 'button',
                  className: 'anno-ask-btn primary',
                  onClick: () => askQuestion(st.question),
                }, translate('ask.send')),
              ),
            ),
          ),
        );
      }

      if (ui.toast) out.push(h('div', { key: 'toast', className: 'anno-toast' }, ui.toast));

      boxes.forEach((box, i) => {
        box.rects.forEach((r, j) => {
          out.push(
            h('div', {
              key: 'hl-' + box.id + '-' + i + '-' + j,
              className: 'anno-hl',
              'data-ghost': box.ghost ? '1' : undefined,
              style: { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' },
            }),
          );
        });
        if (!box.ghost && box.end) {
          out.push(
            h(
              'button',
              {
                key: 'badge-' + box.id,
                type: 'button',
                className: 'anno-badge',
                'data-anno-badge': '1',
                title: translate('badge.title', { n: box.index }),
                style: { left: box.end.right - 14 + 'px', top: box.end.bottom - 10 + 'px' },
                onMouseDown: (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                },
                onClick: (ev) => {
                  ev.stopPropagation();
                  openEditor(box.id);
                },
              },
              box.index,
            ),
          );
        }
      });

      if (ui.open && ui.anchor && ui.anchor.end) {
        const end = ui.anchor.end;
        const width = Math.min(380, window.innerWidth - 24);
        const left = Math.max(12, Math.min(end.left - 6, window.innerWidth - width - 12));
        const style =
          end.top > 200
            ? { left: left + 'px', width: width + 'px', bottom: window.innerHeight - end.top + 12 + 'px' }
            : { left: left + 'px', width: width + 'px', top: end.bottom + 12 + 'px' };
        const badgeNo = ui.editingId != null ? annos.findIndex((a) => a.id === ui.editingId) + 1 : annos.length + 1;
        out.push(
          h(
            'div',
            {
              key: 'pop',
              ref: popRef,
              className: 'anno-pop',
              style: style,
              onMouseDown: (ev) => ev.stopPropagation(),
            },
            h('input', {
              ref: inputRef,
              value: ui.note,
              placeholder: translate('pop.placeholder'),
              spellCheck: false,
              onChange: (ev) => {
                ui.note = ev.target.value;
                emit();
              },
              onKeyDown: (ev) => {
                if (ev.nativeEvent && ev.nativeEvent.isComposing) return;
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitAnnotation();
                }
              },
            }),
            h(
              'div',
              { className: 'anno-pop-foot' },
              h('span', null, translate('pop.hint')),
              h(
                'div',
                { className: 'anno-pop-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'anno-btn',
                    onMouseDown: (ev) => ev.preventDefault(),
                    onClick: (ev) => {
                      ev.stopPropagation();
                      closePopover();
                    },
                  },
                  translate('pop.cancel'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'anno-btn primary',
                    onMouseDown: (ev) => ev.preventDefault(),
                    onClick: (ev) => {
                      ev.stopPropagation();
                      commitAnnotation();
                    },
                  },
                  translate('pop.save'),
                ),
              ),
            ),
            h('div', { className: 'anno-pop-badge' }, badgeNo),
          ),
        );
      }

      return out;
      }

      return h(React.Fragment, null, children);
    }

    /* ------------------------------------------------------------------- dock */

    function AnnoDock(props) {
      useTick();
      const tr = props.t || translate;
      const useInput = props.useInput;
      const inputActions = props.inputActions;

      const [open, setOpen] = useState(false);
      const placeholderOn = useRef(false);
      const [, setBeat] = useState(0);
      const chipRef = useRef(null);
      const panelRef = useRef(null);

      const input = typeof useInput === 'function' ? useInput((s) => s) : null;

      /* the global Enter/click listeners below are mounted once: they must read
         the current composer face, not the one captured on first render */
      const latest = useRef({ input: null, actions: null });
      latest.current.input = input;
      latest.current.actions = inputActions;
      composer.actions = inputActions;
      composer.sessionId = props.sessionId;
      composer.draft = () => {
        const state = latest.current.input;
        return state && typeof state.draft === 'string' ? state.draft : '';
      };

      const wrapRef = useRef(null);
      const [box, setBox] = useState(null);

      /* line the chip up with the composer: measure the editor, not the full-width dock row */
      useEffect(() => {
        const read = () => {
          const wrap = wrapRef.current;
          const editor = document.querySelector('[contenteditable="true"], textarea');
          if (!wrap || !editor) return;
          const er = editor.getBoundingClientRect();
          if (er.width < 80) return;
          /* The wrapper's own margin is what we write, so zero it while measuring:
             measuring against the already-shifted box feeds the value back into
             itself and the chip walks left and right on every tick. */
          const applied = wrap.style.marginLeft;
          wrap.style.marginLeft = '0px';
          const wr = wrap.getBoundingClientRect();
          wrap.style.marginLeft = applied;
          const next = { width: Math.round(er.width), marginLeft: Math.max(0, Math.round(er.left - wr.left)) };
          setBox((prev) =>
            prev && prev.width === next.width && prev.marginLeft === next.marginLeft ? prev : next,
          );
        };
        read();
        window.addEventListener('resize', read);
        const timer = window.setInterval(read, 1200);
        return () => {
          window.removeEventListener('resize', read);
          window.clearInterval(timer);
        };
      }, []);

      /* 草稿是唯一事实来源：块被手删或消息发出后，胶囊里也同步消失 */
      useEffect(() => {
        if (!composer.actions) return;
        const draft = composer.draft();
        let changed = false;
        for (let i = annos.length - 1; i >= 0; i -= 1) {
          const a = annos[i];
          if (!a.block) continue;
          if (Date.now() - (a.writtenAt || 0) < 900) continue;
          if (draft.indexOf(a.block) < 0) {
            annos.splice(i, 1);
            changed = true;
          }
        }
        if (changed) emit();
      });

      /* a slow beat re-checks anchors: a message can re-render without any scroll */
      useEffect(() => {
        const timer = window.setInterval(() => setBeat((v) => v + 1), 1500);
        return () => window.clearInterval(timer);
      }, []);

      useEffect(() => {
        if (!open) return;
        const onDown = (ev) => {
          if (panelRef.current && panelRef.current.contains(ev.target)) return;
          if (chipRef.current && chipRef.current.contains(ev.target)) return;
          setOpen(false);
        };
        const onKey = (ev) => {
          if (ev.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const live = liveAnnos();
      const layerEl = h(AnnoLayer, { key: 'anno-layer' });
      if (!live.length) {
        return h(React.Fragment, null, h('style', null, css), layerEl);
      }

      const panelStyle = (() => {
        if (!chipRef.current) return { left: 12 + 'px', bottom: 120 + 'px' };
        const rect = chipRef.current.getBoundingClientRect();
        const width = Math.min(400, window.innerWidth - 32);
        return {
          left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px',
          bottom: window.innerHeight - rect.top + 8 + 'px',
          width: width + 'px',
        };
      })();

      const jumpTo = (a) => () => {
        const range = resolveRange(a);
        const node = range && range.startContainer;
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      };

      const card = h(
            'div',
            { key: 'card', className: 'anno-card' },
            h(
              'div',
              { className: 'anno-card-head' },
              h('span', null, tr('panel.title', { n: live.length })),
              h(
                'button',
                {
                  type: 'button',
                  className: 'anno-card-clear',
                  onClick: () => {
                    annos.forEach((a) => removeBlock(a));
                    annos.length = 0;
                    setOpen(false);
                    emit();
                  },
                },
                tr('panel.clear'),
              ),
            ),
            live.map((a, i) =>
              h(
                'div',
                { key: a.id, className: 'anno-card-item', onClick: jumpTo(a) },
                h('span', { className: 'anno-item-idx' }, i + 1),
                h(
                  'span',
                  { className: 'anno-card-body' },
                  h('span', { className: 'anno-item-quote', dangerouslySetInnerHTML: { __html: a.html || esc(a.text) } }),
                  a.note ? h('span', { className: 'anno-item-note' }, a.note) : null,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'anno-item-del',
                    title: tr('item.delete', { n: i + 1 }),
                    onClick: (ev) => {
                      ev.stopPropagation();
                      removeAnno(a.id);
                    },
                  },
                  '✕',
                ),
              ),
            ),
          );

      const wrapStyle = box ? { width: box.width + 'px', marginLeft: box.marginLeft + 'px' } : undefined;

      const chip = h(
        'button',
        {
          key: 'chip',
          ref: chipRef,
          type: 'button',
          className: 'anno-chip',
          onClick: () => setOpen((v) => !v),
        },
        '💬 ',
        tr('chip.many', { n: live.length }),
      );

      return h(
        React.Fragment,
        null,
        h('style', null, css),
        layerEl,
        h('div', { ref: wrapRef, className: 'anno-chip-wrap' + (open ? ' anno-pinned' : ''), style: wrapStyle }, chip, card),
      );
    }

    /** 消息流内的旁问卡片（挂在 conversation.chat.turnTail）。 */
    function AnnoAskCard(props) {
      useTick();
      const tr = props.t || translate;
      const st = ui.ask;
      if (!st || st.phase === 'asking') return null;
      return h(
        'div',
        { className: 'anno-ask-card' },
        h(
          'div',
          { className: 'anno-ask-card-head' },
          h('span', { className: 'anno-ask-card-q' }, '💬 ' + st.question),
          h('button', {
            type: 'button',
            className: 'anno-ask-x',
            title: tr('ask.cancel'),
            onClick: () => {
              ui.ask = null;
              emit();
            },
          }, '✕'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'anno-ask-quote-toggle',
            onClick: () => {
              st.showQuote = !st.showQuote;
              emit();
            },
          },
          (st.showQuote ? '▾ ' : '▸ ') + tr('ask.reference'),
        ),
        st.showQuote ? h('div', { className: 'anno-ask-quote' }, st.quote) : null,
        h(
          'div',
          { className: 'anno-ask-body' },
          st.phase === 'pending' && !st.text
            ? h('span', { className: 'anno-ask-pending' }, tr('ask.pending'))
            : st.error
              ? h('span', { className: 'anno-ask-error' }, st.error)
              : h('span', null, st.text),
        ),
      );
    }

    /* ------------------------------------------------------------------- boot */

    function apply(ctx) {
      hostCtx = ctx;
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: zh,
            en: en,
          }),
        'annotation: dictionaries',
      );
      try {
        translate = ctx.locale.bind(NS);
      } catch (err) {
        /* keep the built-in fallback translator */
      }

      ctx.slots.inject('conversation.chat.turnTail', () =>
        ctx.slots.register(
          { name: 'conversation.chat.turnTail', id: 'annotation-ask', order: 60, locale: NS },
          AnnoAskCard,
        ),
      );

      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          { name: 'conversation.input.dock', id: 'annotation-chip-v7', order: -40, locale: NS },
          AnnoDock,
        ),
      );
    }

    return {
      inject: ['locale', 'slots'],
      apply: apply,
    };
  },
});
