// This file only edits existing interface text nodes and accessibility labels.
// The launcher inserts the dictionary at build time; no code or data is fetched.
(() => {
  const VERSION = '0.2.1';
  const REVISION = '__AG_ZH_REVISION__';
  if (window.__antigravityZhCN?.version === VERSION && window.__antigravityZhCN?.revision === REVISION) {
    return window.__antigravityZhCN.status();
  }
  window.__antigravityZhCN?.stop();
  const dictionary = __AG_ZH_DICTIONARY__;
  const originalText = new Map();
  const originalAttributes = new Map();
  const attributes = ['aria-label', 'title', 'placeholder', 'data-placeholder'];
  const protectedSelector = [
    'script', 'style', 'noscript', 'pre', 'code', 'kbd', 'samp', 'textarea', 'input',
    '[contenteditable]:not([contenteditable="false"])', '[data-lexical-editor]',
    'iframe', 'webview', '.monaco-editor', '.cm-editor', '.xterm',
    '.markdown', '.markdown-body', '.prose', '[role="log"]',
    '[data-ag-zh-ignore]',
    '[data-testid*="message-content"]', '[data-testid*="message-body"]',
    '[data-testid*="conversation-title"]', '[data-testid*="project-name"]',
    '[data-testid*="file-name"]'
  ].join(',');
  const messageSelector = [
    '[data-message-id]', '[aria-label="User message"]', '[aria-label="Agent response"]',
    '[aria-label="用户消息"]', '[aria-label="智能体回复"]'
  ].join(',');
  const regionSelector = [
    '.settings-modal-container', '[role="dialog"]', '[role="alertdialog"]',
    '[role="menu"]', '[role="listbox"]', '[role="tooltip"]', '[role="tablist"]',
    '[data-testid="automations-button"]', '[data-testid="settings-button"]',
    '[data-testid="model-selector-trigger"]', '[data-testid="permissions-selector-trigger"]'
  ].join(',');
  const sidebarControls = new Set(['Projects', 'Automations', 'Settings']);
  const sidebarLinks = new Set(['/', '/history', '/customizations', '/customizations/installed']);
  let scheduled = null;
  let stopped = false;
  const oldLang = document.documentElement.getAttribute('lang');

  function translate(value, modelLabel = false) {
    if (!value || typeof value !== 'string') return value;
    const text = value.trim();
    let result = Object.prototype.hasOwnProperty.call(dictionary, text) ? dictionary[text] : null;
    if (result === null && modelLabel) {
      const model = text.match(/^(.+) \((Thinking|Low|Medium|High)\)$/);
      if (model) result = `${model[1]}（${model[2] === 'Thinking' ? '思考模式' : dictionary[model[2]] || model[2]}）`;
      const effort = text.match(/^((?:Gemini|Claude|GPT)[^\r\n]+) (Low|Medium|High)$/);
      if (effort) result = `${effort[1]} ${dictionary[effort[2]] || effort[2]}`;
    }
    // Only these explicit accessibility label formats contain dynamic values.
    if (result === null) {
      for (const [prefix, chinese] of [
        ['Select project, current: ', '选择项目，当前：'],
        ['Select model, current: ', '选择模型，当前：'],
        ['Agent permissions preset selector, current: ', '智能体权限预设，当前：']
      ]) {
        if (text.startsWith(prefix)) {
          const suffix = text.slice(prefix.length);
          // User-assigned project names are always kept verbatim.
          const translatedSuffix = prefix.startsWith('Select project')
            ? (suffix === 'No Project' ? dictionary[suffix] : suffix)
            : (prefix.startsWith('Select model') ? translate(suffix, true) : (dictionary[suffix] || suffix));
          result = chinese + translatedSuffix;
          break;
        }
      }
    }
    if (result === null) {
      let match = text.match(/^No more older messages, showing (\d+) of (\d+)$/);
      if (match) result = `已无更早的消息，当前显示 ${match[1]}/${match[2]} 条`;
      match = text.match(/^(Cancel|Stop|Send|Copy) (\([^\r\n]{1,24}\))$/);
      if (match) result = `${dictionary[match[1]] || match[1]} ${match[2]}`;
      match = text.match(/^(\d+) (second|minute|hour|day)s? ago$/);
      if (match) result = `${match[1]} ${({second:'秒',minute:'分钟',hour:'小时',day:'天'})[match[2]]}前`;
      match = text.match(/^(\d+)([smhdw])(?: ago)?$/);
      if (match) result = `${match[1]} ${({s:'秒',m:'分钟',h:'小时',d:'天',w:'周'})[match[2]]}前`;
      match = text.match(/^(Thought for|Thinking for) (\d+(?:\.\d+)?)(ms|s|m)$/);
      if (match) result = `${match[1] === 'Thought for' ? '已思考' : '正在思考'} ${match[2]} ${({ms:'毫秒',s:'秒',m:'分钟'})[match[3]]}`;
    }
    if (result === null) return value;
    return value.slice(0, value.indexOf(text)) + result + value.slice(value.indexOf(text) + text.length);
  }

  function protectedContent(element) {
    return !element || Boolean(element.closest(protectedSelector));
  }

  function isModelLabel(element) {
    return Boolean(element.closest('[data-testid^="model-selector"]'));
  }

  function isProjectChoice(element) {
    const popup = element.closest('[role="menu"],[role="listbox"],[role="dialog"]');
    if (!popup) return false;
    const ids = (popup.getAttribute('aria-labelledby') || '').split(/\s+/);
    return ids.some(id => document.getElementById(id)?.getAttribute('data-testid') === 'project-selector-trigger');
  }

  function textIsUI(node) {
    const element = node.parentElement;
    if (protectedContent(element)) return false;
    // Real conversation containers also hold toolbar buttons. Translate only
    // their controls, keeping the user's text and the agent's prose untouched.
    if (element.closest(messageSelector)) {
      return Boolean(element.closest('button,[role="button"],[role="menuitem"]'));
    }
    if (isProjectChoice(element) && node.nodeValue.trim() !== 'No Project') return false;
    // Sidebar entries can contain user-named projects and conversations.
    const sidebar = element.closest('[role="navigation"][aria-label="Sidebar"], [role="navigation"][aria-label="侧边栏"]');
    if (sidebar) {
      const link = element.closest('a');
      if (link) {
        const path = new URL(link.href, location.href).pathname;
        return sidebarLinks.has(path);
      }
      return Boolean(element.closest('[data-testid="automations-button"], [data-testid="settings-button"]')) ||
        (Boolean(element.closest('h2')) && sidebarControls.has(node.nodeValue.trim())) ||
        (!element.closest('button') && /^\d+[smhdw](?: ago)?$/.test(node.nodeValue.trim()));
    }
    if (element.closest(regionSelector)) return true;
    const link = element.closest('a');
    if (link && !sidebarLinks.has(new URL(link.href, location.href).pathname) &&
        !element.closest('button,[role="button"]')) return false;
    // Remaining app chrome includes page descriptions, empty states, toolbar
    // labels and timestamps. Only complete dictionary entries or explicit
    // dynamic formats can match; content containers above are excluded.
    return true;
  }

  function translateTextNode(node) {
    const saved = originalText.get(node);
    if (saved && node.nodeValue !== saved.translated) originalText.delete(node);
    if (!textIsUI(node)) return;
    const current = node.nodeValue;
    const next = translate(current, isModelLabel(node.parentElement));
    if (next !== current) {
      originalText.set(node, { original: current, translated: next });
      node.nodeValue = next;
    }
  }

  function translateAttributes(element) {
    // Translate control labels/placeholders, never editable values or content.
    if (element.closest('pre,code,.monaco-editor,.cm-editor,.xterm,.markdown,.markdown-body,.prose,[data-ag-zh-ignore],[data-testid*="conversation-title"],[data-testid*="project-name"],[data-testid*="file-name"]')) return;
    if (element.closest(messageSelector) && !element.matches('button,[role="button"]')) return;
    if (isProjectChoice(element)) return;
    const sidebarLink = element.closest('[role="navigation"] a');
    if (sidebarLink && !sidebarLinks.has(new URL(sidebarLink.href, location.href).pathname)) return;
    if (!element.matches('button,a,input,textarea,[role],[contenteditable],[data-placeholder]') && !element.closest(regionSelector)) return;
    for (const name of attributes) {
      const current = element.getAttribute(name);
      if (current === null) continue;
      const saved = originalAttributes.get(element)?.get(name);
      if (saved && current !== saved.translated) originalAttributes.get(element).delete(name);
      // Preserve user-named project/conversation/file tooltips.
      if (name === 'title' && !element.matches('button,[role="button"]') && !element.closest('.settings-modal-container')) continue;
      const next = translate(current);
      if (next !== current) {
        if (!originalAttributes.has(element)) originalAttributes.set(element, new Map());
        originalAttributes.get(element).set(name, { original: current, translated: next });
        element.setAttribute(name, next);
      }
    }
  }

  const observer = new MutationObserver(schedule);
  function observe() {
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: attributes
    });
  }
  function refresh() {
    if (stopped) return;
    observer.disconnect();
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) translateTextNode(walker.currentNode);
      document.querySelectorAll('[aria-label],[title],[placeholder],[data-placeholder]').forEach(translateAttributes);
      for (const node of originalText.keys()) if (!node.isConnected) originalText.delete(node);
      for (const node of originalAttributes.keys()) if (!node.isConnected) originalAttributes.delete(node);
      document.documentElement.lang = 'zh-CN';
    } finally {
      observe();
    }
  }
  function schedule() {
    if (!stopped && scheduled === null) {
      scheduled = setTimeout(() => { scheduled = null; refresh(); }, 60);
    }
  }
  function stop() {
    stopped = true;
    observer.disconnect();
    if (scheduled !== null) clearTimeout(scheduled);
    for (const [node, saved] of originalText) {
      if (node.isConnected && node.nodeValue === saved.translated) node.nodeValue = saved.original;
    }
    for (const [node, entries] of originalAttributes) {
      for (const [name, saved] of entries) {
        if (node.isConnected && node.getAttribute(name) === saved.translated) node.setAttribute(name, saved.original);
      }
    }
    if (document.documentElement.lang === 'zh-CN') {
      if (oldLang === null) document.documentElement.removeAttribute('lang');
      else document.documentElement.setAttribute('lang', oldLang);
    }
    originalText.clear();
    originalAttributes.clear();
    delete window.__antigravityZhCN;
    return { restored: true };
  }
  window.__antigravityZhCN = {
    version: VERSION, revision: REVISION, stop,
    status: () => ({ version: VERSION, revision: REVISION, textNodes: originalText.size, labelledControls: originalAttributes.size })
  };
  refresh();
  return window.__antigravityZhCN.status();
})();
