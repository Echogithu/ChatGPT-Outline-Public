(function initHistoryLoader(global) {
  const state = global.__CHATGPT_HELPER__;
  const dom = state.domAdapter;
  let turns = [];
  let generation = 0;
  let task = null;
  let indexed = false;
  let lastLiveIds = new Set();
  let lastTop = 0;
  let lastHeight = 0;
  let scrollingUntil = 0;
  let scanDirection = null;
  let restorePending = null;
  let scannedIds = null;
  const CACHE_PREFIX = "outlineDirectory:v1:";
  const storage = state.extensionApi?.storage?.local;
  const conversationKey = () => CACHE_PREFIX + (location.pathname.match(/\/(?:c|share)\/([^/]+)/)?.[1] || location.pathname);
  window.addEventListener("scroll", () => { scrollingUntil = Date.now() + 1000; }, true);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const viewportTop = (container) => container === document.scrollingElement ? 0 : container.getBoundingClientRect().top;

  function restoreCache() {
    const key = conversationKey();
    if (restorePending?.key === key) return restorePending.promise;
    const pending = { key };
    restorePending = pending;
    pending.promise = (async () => {
      if (!storage?.get) return;
      try {
        const cache = (await storage.get(key))[key];
        if (restorePending !== pending || conversationKey() !== key || !cache || cache.version !== 1
          || !Number.isFinite(cache.updatedAt) || Date.now() - cache.updatedAt > 7 * 86400000
          || !Number.isFinite(cache.width) || !Number.isFinite(cache.height) || !Array.isArray(cache.turns)
          || cache.turns.length > 4000 || !cache.turns.every((turn) =>
            typeof turn.id === "string" && turn.id.includes("-source-") && Number.isFinite(turn.position)
            && ["question", "answer"].includes(turn.kind)
            && (turn.kind !== "question" || typeof turn.title === "string")
            && (turn.kind !== "answer" || Array.isArray(turn.headings) && turn.headings.every((h) =>
              typeof h.id === "string" && typeof h.messageId === "string" && typeof h.text === "string")))) return;
        const live = [...dom.getQuestionItems(), ...dom.getAssistantMessages()];
        // 至少匹配一个当前消息才恢复，避免错误路由或尚未就绪页面显示其他会话缓存。
        if (!live.some((item) => cache.turns.some((turn) => turn.id === item.id))) return;
        const container = dom.getScrollContainer();
        if (!container) return;
        turns = cache.turns.map((turn) => ({ ...turn, element: null, contentElement: null,
          headings: turn.headings?.map((heading) => ({ ...heading, element: null })) }));
        indexed = cache.complete === true && cache.width === container.clientWidth
          && Math.abs(cache.height - container.scrollHeight) < 4;
        lastLiveIds = new Set();
        lastHeight = container.scrollHeight;
        lastTop = dom.getScrollMetrics(container).position;
        collect();
      } catch (error) { console.warn("ChatGPT 目录：读取缓存失败，将重新加载。", error); }
    })();
    return pending.promise;
  }

  async function saveCache() {
    const container = dom.getScrollContainer();
    if (!storage?.set || !container || !indexed || turns.some((turn) => !turn.id.includes("-source-"))) return;
    const key = conversationKey();
    const cache = { version: 1, complete: true, updatedAt: Date.now(), width: container.clientWidth,
      height: container.scrollHeight, turns: turns.map((turn) => ({ id: turn.id, kind: turn.kind,
        title: turn.title || "", position: turn.position,
        headings: turn.headings?.map(({ element, ...heading }) => heading) || [] })) };
    if (new TextEncoder().encode(JSON.stringify(cache)).byteLength > 400000) {
      console.warn("ChatGPT 目录：目录较大，本次仅保留页面内存缓存。");
      return;
    }
    try {
      await storage.set({ [key]: cache });
      const values = await storage.get(null);
      const keys = Object.keys(values).filter((name) => name.startsWith(CACHE_PREFIX))
        .sort((a, b) => (values[b].updatedAt || 0) - (values[a].updatedAt || 0));
      const expired = keys.filter((name, index) => index >= 10 || Date.now() - values[name].updatedAt > 7 * 86400000);
      if (expired.length) await storage.remove(expired);
    } catch (error) { console.warn("ChatGPT 目录：保存缓存失败，本次目录仍可使用。", error); }
  }

  function collect() {
    const container = dom.getScrollContainer();
    if (!container) return [];
    const position = dom.getScrollMetrics(container).position;
    const live = [
      ...dom.getQuestionItems().map((item) => ({ ...item, kind: "question" })),
      ...dom.getAssistantMessages().map((item) => ({
        ...item, kind: "answer", headings: dom.extractHeadings(item.contentElement, item.id)
      }))
    ].sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const liveIds = new Set(live.map((turn) => turn.id));
    if (scannedIds) liveIds.forEach((id) => scannedIds.add(id));
    const noOverlap = turns.length && live.length && !turns.some((turn) => liveIds.has(turn.id));
    const heightDelta = container.scrollHeight - lastHeight;
    const prepend = noOverlap && (position < lastTop
      || heightDelta > 0 && (position === 0 || scanDirection === "up"));
    live.forEach((item) => {
      item.position = position + item.element.getBoundingClientRect().top - viewportTop(container);
    });
    const overlap = live.find((item) => turns.some((cached) => cached.id === item.id));
    const anchorShift = overlap ? overlap.position - turns.find((cached) => cached.id === overlap.id).position : 0;
    // 分页窗口有重叠时，用原消息的位移校准已卸载消息；随后覆盖仍在 DOM 内的真实位置。
    const shift = heightDelta > 0 && Math.abs(anchorShift - heightDelta) < 2 ? anchorShift
      : prepend && heightDelta > 0 ? heightDelta : 0;
    if (shift) turns.forEach((turn) => { turn.position += shift; });
    // 扫描或滚动中的虚拟卸载保留目录；同位置的新身份仍须替换旧身份。
    const removed = new Set([...lastLiveIds].filter((id) => !liveIds.has(id)));
    if (removed.size) {
      const settled = !task && Date.now() > scrollingUntil && Math.abs(position - lastTop) < 2 && heightDelta <= 0;
      const added = live.filter((item) => !turns.some((turn) => turn.id === item.id));
      const obsolete = new Set(turns.filter((turn) => removed.has(turn.id) && ((!task && heightDelta < 0) || settled
        // 有共同消息才能校准坐标，避免把不重叠的虚拟分页误判为替换。
        || overlap && added.some((item) => item.kind === turn.kind && Math.abs(item.position - turn.position) < 2)))
        .map((turn) => turn.id));
      if (obsolete.size) {
        turns = turns.filter((turn) => !obsolete.has(turn.id));
        indexed = false;
      }
    }
    if (live.some((turn) => !turns.some((cached) => cached.id === turn.id))) indexed = false;
    turns = turns.filter((turn) => !turn.id.includes("-local-") || turn.element?.isConnected);
    live.forEach((item, i) => {
      const existing = turns.findIndex((turn) => turn.id === item.id);
      if (existing >= 0) turns[existing] = item;
      else {
        const previous = i ? turns.findIndex((turn) => turn.id === live[i - 1].id) : -1;
        const next = live.slice(i + 1).map((turn) => turns.findIndex((cached) => cached.id === turn.id)).find((index) => index >= 0);
        const following = turns.findIndex((cached) => cached.position > item.position);
        turns.splice(previous >= 0 ? previous + 1 : following >= 0 ? following
          : next ?? (prepend ? 0 : turns.length), 0, item);
      }
    });
    // 虚拟列表移除正文后只保留目录元数据，避免持有整段已卸载的回答 DOM。
    turns.forEach((turn) => {
      if (!turn.element?.isConnected) {
        turn.element = null;
        turn.contentElement = null;
        turn.headings?.forEach((heading) => { heading.element = null; });
      }
    });
    lastLiveIds = liveIds;
    lastTop = position;
    lastHeight = container.scrollHeight;
    return getGroups();
  }

  function getGroups() {
    const groups = [];
    let current = null;
    turns.forEach((turn) => {
      if (turn.kind === "question") {
        current = { ...turn, index: groups.length, answers: [] };
        groups.push(current);
      } else if (current) current.answers.push(turn);
    });
    return groups;
  }

  function cancel() {
    generation += 1;
    task = null;
    scanDirection = null;
    scannedIds = null;
  }

  function reset() {
    cancel();
    turns = [];
    indexed = false;
    lastLiveIds = new Set();
    lastTop = 0;
    lastHeight = 0;
    restorePending = null;
  }

  function signature(container) {
    return `${container.scrollHeight}:${turns.map((turn) => `${turn.id}:${turn.headings?.length || 0}`).join("|")}`;
  }

  async function seekBoundary(boundary, valid, deadline, onProgress) {
    let stable = 0;
    let previous = "";
    while (valid() && Date.now() < deadline) {
      scanDirection = boundary === "top" ? "up" : "down";
      dom.scrollToBoundary(boundary);
      await wait(450);
      if (!valid()) return false;
      collect();
      onProgress?.();
      const container = dom.getScrollContainer();
      if (!container) return false;
      const metrics = dom.getScrollMetrics(container);
      const atEdge = boundary === "top" ? metrics.position < 2 : metrics.length - metrics.position < 2;
      const next = signature(container);
      const loading = dom.getConversationRoot()?.querySelector("[aria-busy='true'], [role='progressbar']");
      stable = atEdge && next === previous && !loading ? stable + 1 : 0;
      previous = next;
      // 多次等待，覆盖较早消息加载后滚动锚定把视口推离顶部的情况。
      if (stable >= (boundary === "top" ? 9 : 3)) return true;
    }
    return false;
  }

  async function reveal(id, token = generation) {
    const target = turns.find((turn) => turn.id === id);
    if (!target) return false;
    if (target.element?.isConnected) return true;
    const container = dom.getScrollContainer();
    const root = dom.getConversationRoot();
    const location = window.location.href;
    if (!container) return false;
    scanDirection = target.position < dom.getScrollMetrics(container).position ? "up" : "down";
    dom.scrollToPosition(container, target.position - 96);
    await wait(450);
    if (generation !== token || root !== dom.getConversationRoot() || location !== window.location.href) return false;
    collect();
    return Boolean(turns.find((turn) => turn.id === id)?.element?.isConnected);
  }

  async function load({ onProgress, onStart, boundary, allowScan = true, force = false } = {}) {
    const requestedLocation = window.location.href;
    const requestedGeneration = generation;
    if (!boundary) await restoreCache();
    if (requestedLocation !== window.location.href || requestedGeneration !== generation) return "interrupted";
    collect();
    if (force) indexed = false;
    if (!boundary && indexed) return Promise.resolve("indexed");
    if (!boundary && !allowScan) return "paused";
    if (!boundary && task) return task;
    cancel();
    const token = generation;
    const location = window.location.href;
    const root = dom.getConversationRoot();
    const valid = () => generation === token && location === window.location.href && root === dom.getConversationRoot();
    const container = dom.getScrollContainer();
    if (!root || !container) return Promise.resolve("unavailable");
    onStart?.();
    if (!boundary) scannedIds = new Set();
    collect();
    const anchor = turns.filter((turn) => turn.element?.isConnected)
      .sort((a, b) => Math.abs(a.element.getBoundingClientRect().top - viewportTop(container))
        - Math.abs(b.element.getBoundingClientRect().top - viewportTop(container)))[0];
    const anchorTop = anchor?.element.getBoundingClientRect().top;
    const positions = [];
    for (let node = container; node; node = node.parentElement) positions.push([node, node.scrollTop]);
    const abortOnInput = (event) => {
      if (event.target instanceof Element && event.target.closest(".chatgpt-helper-sidebar, .chatgpt-helper-message-outline, .chatgpt-helper-loading-notice")) return;
      if (event.type === "keydown" && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      cancel();
    };
    ["wheel", "touchstart", "pointerdown", "keydown"].forEach((type) => window.addEventListener(type, abortOnInput, { capture: true, passive: true }));
    task = (async () => {
      const deadline = Date.now() + 180000;
      let result = "interrupted";
      try {
        // 首次扫描先显示说明，再移动正文，避免无提示地跳到历史开头。
        if (!boundary) await wait(200);
        if (!valid()) return result;
        const firstEdge = await seekBoundary(boundary || "top", valid, deadline, onProgress);
        if (!valid()) return result;
        if (!firstEdge) return "limited";
        if (!boundary) {
          // 每次移动不足一屏，触发中间轮次和回答标题的延迟渲染。
          while (valid() && Date.now() < deadline) {
            const current = dom.getScrollContainer();
            if (!current) break;
            const metrics = dom.getScrollMetrics(current);
            if (metrics.position >= metrics.length - 2) break;
            scanDirection = "down";
            dom.scrollToPosition(current, metrics.position + Math.max(100, current.clientHeight * 0.8));
            await wait(150);
            const contentDeadline = Math.min(deadline, Date.now() + 5000);
            while (valid() && Date.now() < contentDeadline && root.querySelector("[aria-busy='true'], [role='progressbar']")) await wait(150);
            if (!valid()) return result;
            collect();
            onProgress?.();
          }
          if (!valid()) return result;
          indexed = await seekBoundary("bottom", valid, deadline, onProgress);
          if (indexed && scannedIds) turns = turns.filter((turn) => scannedIds.has(turn.id))
            .sort((a, b) => a.position - b.position);
          scannedIds = null;
          result = indexed ? "indexed" : "limited";
        } else result = "boundary";
        return result;
      } finally {
        ["wheel", "touchstart", "pointerdown", "keydown"].forEach((type) => window.removeEventListener(type, abortOnInput, true));
        if (generation === token && location === window.location.href && root === dom.getConversationRoot()) {
          if (!boundary) {
            // 先恢复外层滚动，再按消息锚点补偿上方新增内容；虚拟列表先重新渲染锚点。
            for (const [node, top] of positions.slice().reverse()) node.scrollTo({ top, behavior: "instant" });
            if (anchor && await reveal(anchor.id, token)) {
              const liveAnchor = turns.find((turn) => turn.id === anchor.id)?.element;
              if (generation === token && liveAnchor) container.scrollBy({ top: liveAnchor.getBoundingClientRect().top - anchorTop, behavior: "instant" });
            }
          }
          if (generation === token) {
            collect();
            onProgress?.();
            task = null;
            scanDirection = null;
            scannedIds = null;
            if (!boundary && indexed) await saveCache();
          }
        }
      }
    })();
    return task;
  }

  state.historyLoader = { collect, getGroups, load, reveal, cancel, reset };
})(globalThis);
