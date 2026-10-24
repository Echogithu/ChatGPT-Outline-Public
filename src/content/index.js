(function initApp(global) {
  const NAMESPACE = "__CHATGPT_HELPER__";
  const state = (global[NAMESPACE] = global[NAMESPACE] || {});

  if (state.appInitialized) {
    return;
  }

  const domAdapter = state.domAdapter;
  const sidebarApi = state.sidebar;
  const messageOutlineApi = state.messageOutline;

  if (!domAdapter || !sidebarApi) {
    return;
  }

  state.appInitialized = true;

  const historyLoader = state.historyLoader;
  const settings = state.settings;
  const extensionApi = state.extensionApi;
  let layout = settings.DEFAULT_LAYOUT;
  let questionGroups = [];
  let settingsRevision = 0;
  let themeRevision = 0;

  function applyTheme(value) {
    document.documentElement.dataset.chatgptHelperTheme = settings.normalizeTheme(value);
  }

  function questionSide() { return ["questions-left", "merged-left"].includes(layout) ? "left" : "right"; }

  function applyLayout(value) {
    layout = settings.normalizeLayout(value);
    document.documentElement.dataset.chatgptHelperLayout = layout;
    if (sidebar) sidebar.root.dataset.side = questionSide();
    if (messageOutline) {
      messageOutline.root.dataset.side = layout === "questions-left" ? "right" : "left";
      messageOutline.updatePosition();
    }
    refreshQuestions();
  }

  let sidebar = null;
  let messageOutline = null;
  let items = [];
  let activeId = null;
  let currentLocation = `${window.location.pathname}${window.location.search}`;
  let currentConversationRoot = domAdapter.getConversationRoot?.() || null;
  let spacedConversationRoot = null;

  function prepareContentSpace(refreshBase = false) {
    const root = items.length ? domAdapter.getConversationRoot?.() : null;
    if (root === spacedConversationRoot && !refreshBase) return;
    if (spacedConversationRoot && spacedConversationRoot !== root) {
      spacedConversationRoot.removeAttribute("data-chatgpt-helper-content");
      spacedConversationRoot.style.removeProperty("--chatgpt-helper-base-padding-left");
      spacedConversationRoot.style.removeProperty("--chatgpt-helper-base-padding-right");
    }
    spacedConversationRoot = root;
    if (!root) return;
    // 读取网站原有留白；收起面板和改变窗口尺寸时仍保留原布局。
    root.removeAttribute("data-chatgpt-helper-content");
    const style = getComputedStyle(root);
    root.style.setProperty("--chatgpt-helper-base-padding-left", style.paddingLeft);
    root.style.setProperty("--chatgpt-helper-base-padding-right", style.paddingRight);
    root.setAttribute("data-chatgpt-helper-content", "");
  }
  let stopObserving = () => {};
  let stopObservingMessages = () => {};
  let scrollTicking = false;
  let refreshTimer = 0;
  let currentScrollContainer = null;
  let activeLockId = null;
  let activeLockDeadline = 0;
  let messageOutlineLockId = null;
  let messageOutlineLockDeadline = 0;
  let historyBusy = false;
  let navigationRevision = 0;
  // 每个会话在当前页面生命周期只自动扫描一次；悬停仍可读缓存，但不能重新滚动。
  const automaticallyLoaded = new Set();

  function autoLoadHistory() {
    if (historyBusy || !domAdapter.isConversationRoute()) return;
    const key = window.location.pathname;
    if (automaticallyLoaded.has(key)) {
      historyLoader.load({ allowScan: false }).then(() => refreshQuestions()).catch((error) => {
        console.warn("ChatGPT 目录：读取缓存失败。", error);
      });
      return;
    }
    automaticallyLoaded.add(key);
    startHistoryLoading();
  }

  function scrollHistoryBoundary(boundary) {
    stopHistoryLoading();
    releaseActiveLock();
    messageOutlineLockId = null;
    messageOutlineLockDeadline = 0;
    setActive(null);
    sidebar?.setActiveHeading(null);
    messageOutline?.setActiveHeading(null);
    startHistoryLoading(boundary);
  }

  function stopHistoryLoading() {
    navigationRevision += 1;
    historyLoader.cancel();
    historyBusy = false;
    sidebar?.setLoading(false, "");
  }

  async function startHistoryLoading(boundary, force = false) {
    const revision = ++navigationRevision;
    historyBusy = true;
    releaseActiveLock();
    messageOutlineLockId = null;
    messageOutlineLockDeadline = 0;
    sidebar?.setLoading(true, "正在读取目录…");
    try {
      const result = await historyLoader.load({ boundary, force, onStart() {
        if (revision === navigationRevision) sidebar?.setLoading(true, "正在准备加载…", !boundary);
      }, onProgress() {
        if (revision !== navigationRevision) return;
        refreshQuestions();
        sidebar?.setLoading(true, `已收集 ${questionGroups.length} 个问题，正在继续加载…`, !boundary);
      } });
      if (revision !== navigationRevision) return;
      const text = result === "limited" ? "加载未结束，点击重新加载可继续"
        : result === "interrupted" ? "加载已暂停，点击重新加载可继续"
        : result === "unavailable" ? "会话内容尚未就绪，点击重新加载可重试"
        : `已索引 ${questionGroups.length} 个问题`;
      sidebar?.setLoading(false, text);
    } catch (error) {
      if (revision === navigationRevision) sidebar?.setLoading(false, "目录加载失败，点击重新加载可重试");
      console.warn("ChatGPT 目录：加载历史失败。", error);
    } finally {
      if (revision === navigationRevision) {
        historyBusy = false;
        refreshQuestions();
      }
    }
  }

  async function revealTurn(id) {
    stopHistoryLoading();
    const revision = navigationRevision;
    const found = await historyLoader.reveal(id);
    if (!found && revision === navigationRevision) {
      refreshQuestions();
      sidebar?.setLoading(false, "目标消息未就绪，点击重新加载可重试");
    }
    return found && revision === navigationRevision;
  }

  function ensureSidebar() {
    if (!sidebar) {
      sidebar = sidebarApi.mount(document.body, {
        onStopLoading() {
          stopHistoryLoading();
          refreshQuestions();
          sidebar?.setLoading(false, "加载已停止，目录仍可使用；点击重新加载可继续");
        },
        onOpen() {
          autoLoadHistory();
        },
        onReload() {
          stopHistoryLoading();
          automaticallyLoaded.add(window.location.pathname);
          startHistoryLoading(undefined, true);
        },
        onScrollBoundary: scrollHistoryBoundary,
        async onSelectHeading(heading, item) {
          if (!await revealTurn(heading.messageId)) return;
          if (!domAdapter.scrollToHeading(heading.id, heading.element, heading)) {
            refreshQuestions();
            return;
          }
          lockActive(item.id);
          lockMessageOutlineToHeading(heading);
          setActive(item.id);
          refreshMessageOutline();
        },
        async onSelectAnswer(answer, item) {
          if (!await revealTurn(answer.id)) return;
          const currentAnswer = domAdapter.getAssistantMessages().find((message) => message.id === answer.id);
          if (!currentAnswer || !domAdapter.scrollToHeading(currentAnswer.id, currentAnswer.contentElement)) {
            refreshQuestions();
            return;
          }
          lockActive(item.id);
          messageOutlineLockId = answer.id;
          messageOutlineLockDeadline = Date.now() + 1600;
          setActive(item.id);
          refreshMessageOutline();
        },
        async onSelect(item) {
          if (!await revealTurn(item.id)) return;
          if (!domAdapter.scrollToQuestion(item.id)) {
            refreshQuestions();
            return;
          }
          lockActive(item.id);
          setActive(item.id);
          refreshMessageOutline();
          window.setTimeout(() => refreshMessageOutline(), 260);
          window.setTimeout(() => refreshMessageOutline(), 900);
        }
      });
    }

    sidebar.root.dataset.side = questionSide();
    return sidebar;
  }

  function ensureMessageOutline() {
    if (!messageOutline && messageOutlineApi?.mount) {
      messageOutline = messageOutlineApi.mount(document.body, {
        onScrollBoundary: scrollHistoryBoundary,
        async onSelect(heading) {
          if (!await revealTurn(heading.messageId)) return;
          if (!domAdapter.scrollToHeading?.(heading.id, heading.element, heading)) {
            refreshQuestions();
            return;
          }
          lockMessageOutlineToHeading(heading);
          window.setTimeout(() => refreshMessageOutline(), 260);
        }
      });
    }

    if (messageOutline) messageOutline.root.dataset.side = layout === "questions-left" ? "right" : "left";
    return messageOutline;
  }

  function pickActiveAssistantMessage() {
    const messages = domAdapter.getAssistantMessages?.() || [];
    if (!messages.length) {
      return null;
    }

    if (messageOutlineLockId && Date.now() < messageOutlineLockDeadline) {
      const lockedMessage = messages.find((message) => message.id === messageOutlineLockId);
      if (lockedMessage) {
        return lockedMessage;
      }
    }

    messageOutlineLockId = null;
    messageOutlineLockDeadline = 0;

    const viewportTop = 120;
    const viewportBottom = Math.max(window.innerHeight - 160, viewportTop + 120);
    let best = null;
    let bestVisibleHeight = 0;

    messages.forEach((message) => {
      const rect = message.element.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, viewportTop);
      const visibleBottom = Math.min(rect.bottom, viewportBottom);
      const visibleHeight = Math.max(visibleBottom - visibleTop, 0);

      if (visibleHeight <= 0) {
        return;
      }

      if (visibleHeight > bestVisibleHeight) {
        bestVisibleHeight = visibleHeight;
        best = message;
      }
    });

    if (best) {
      return best;
    }

    const threshold = viewportTop;
    let fallback = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    messages.forEach((message) => {
      const rect = message.element.getBoundingClientRect();
      const distance = Math.abs(rect.top - threshold);

      if (rect.bottom < threshold - 24) {
        return;
      }

      if (distance < nearestDistance) {
        nearestDistance = distance;
        fallback = message;
      }
    });

    return fallback || messages[messages.length - 1];
  }

  function refreshMessageOutline() {
    if (!domAdapter.isConversationRoute()) {
      messageOutline?.render(null, []);
      return;
    }

    const message = pickActiveAssistantMessage();
    const headings = message
      ? domAdapter.extractHeadings?.(message.contentElement, message.id) || []
      : [];

    const outline = ensureMessageOutline();
    outline?.render(message, headings);
    const group = questionGroups.find((item) => item.answers.some((answer) => answer.id === message?.id));
    if (group && !activeLockId) setActive(group.id);
    const currentHeading = headings.filter((heading) => heading.element.getBoundingClientRect().top <= 160).pop();
    sidebar?.setActiveHeading(currentHeading?.id || null);
    outline?.setActiveHeading(currentHeading?.id || null);
  }

  function lockMessageOutlineToHeading(heading, duration = 1600) {
    const message = (domAdapter.getAssistantMessages?.() || []).find((item) => {
      return item.id === heading.messageId || item.contentElement?.contains?.(heading.element);
    });

    messageOutlineLockId = message?.id || null;
    messageOutlineLockDeadline = messageOutlineLockId ? Date.now() + duration : 0;
  }

  function setActive(id) {
    activeId = id || null;
    sidebar?.setActive(activeId);
  }

  function getItemById(id) {
    return items.find((item) => item.id === id) || null;
  }

  function isLockedTargetSettled() {
    if (!activeLockId) {
      return true;
    }

    const targetItem = getItemById(activeLockId);
    if (!targetItem?.element) {
      return true;
    }

    const rect = targetItem.element.getBoundingClientRect();
    const threshold = 160;
    return Math.abs(rect.top - threshold) <= 36;
  }

  function releaseActiveLock() {
    activeLockId = null;
    activeLockDeadline = 0;
  }

  function lockActive(id, duration = 2000) {
    activeLockId = id || null;
    activeLockDeadline = Date.now() + duration;
  }

  function pickActiveQuestion() {
    if (!items.length) {
      return null;
    }

    const threshold = 160;
    let best = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    items.forEach((item) => {
      const rect = item.element.getBoundingClientRect();
      const distance = Math.abs(rect.top - threshold);

      if (rect.bottom < threshold - 24) {
        return;
      }

      if (distance < nearestDistance) {
        nearestDistance = distance;
        best = item;
      }
    });

    return best || items[items.length - 1];
  }

  function render() {
    const view = ensureSidebar();
    view.render(questionGroups, activeId, layout === "merged" || layout === "merged-left");
  }

  function bindScrollContainer() {
    const nextContainer = domAdapter.getScrollContainer?.() || null;
    if (currentScrollContainer === nextContainer) {
      return;
    }

    if (currentScrollContainer) {
      currentScrollContainer.removeEventListener("scroll", handleScroll);
    }

    currentScrollContainer = nextContainer;

    if (currentScrollContainer) {
      currentScrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    }
  }

  function refreshQuestions(nextItems) {
    items = Array.isArray(nextItems) ? nextItems : domAdapter.getQuestionItems();
    questionGroups = historyLoader.collect();

    if (!domAdapter.isConversationRoute()) {
      items = [];
      messageOutline?.destroy();
      messageOutline = null;
    } else {
      refreshMessageOutline();
    }

    bindScrollContainer();
    prepareContentSpace();
    if (activeLockId) {
      if (isLockedTargetSettled() || Date.now() >= activeLockDeadline) {
        releaseActiveLock();
      } else {
        setActive(activeLockId);
        render();
        refreshMessageOutline();
        return;
      }
    }

    const active = pickActiveQuestion();
    setActive(active?.id || null);
    render();
    refreshMessageOutline();
  }

  function handleScroll() {
    if (historyBusy || scrollTicking) {
      return;
    }

    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      if (historyBusy) return;
      if (activeLockId) {
        if (isLockedTargetSettled() || Date.now() >= activeLockDeadline) {
          releaseActiveLock();
        } else {
          setActive(activeLockId);
          refreshMessageOutline();
          return;
        }
      }

      const active = pickActiveQuestion();
      setActive(active?.id || null);
      refreshMessageOutline();
    });
  }

  function restartObserver() {
    stopObserving();
    stopObservingMessages();
    stopObserving = domAdapter.observeQuestions((nextItems) => {
      refreshQuestions(nextItems);
    });
    stopObservingMessages = domAdapter.observeAssistantMessages?.(() => {
      if (domAdapter.isConversationRoute()) {
        // 标题流式变化时更新树，滚动时只更新高亮，避免反复重建目录。
        items = domAdapter.getQuestionItems();
        questionGroups = historyLoader.collect();
        render();
        refreshMessageOutline();
      }
    }) || (() => {});
  }

  function handleRouteChange() {
    const nextLocation = `${window.location.pathname}${window.location.search}`;
    const nextConversationRoot = domAdapter.getConversationRoot?.() || null;
    if (
      nextLocation === currentLocation &&
      nextConversationRoot === currentConversationRoot
    ) {
      return;
    }

    stopHistoryLoading();
    historyLoader.reset();
    currentLocation = nextLocation;
    currentConversationRoot = nextConversationRoot;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      // ChatGPT 可能先更新 URL，稍后才替换 main；记录最终根节点并绑定新观察器。
      currentConversationRoot = domAdapter.getConversationRoot?.() || null;
      messageOutline?.destroy();
      messageOutline = null;
      sidebar?.resetTree();
      releaseActiveLock();
      messageOutlineLockId = null;
      messageOutlineLockDeadline = 0;
      restartObserver();
      refreshQuestions();
      if (sidebar?.expanded) autoLoadHistory();
    }, 120);
  }

  function patchHistory() {
    const methods = ["pushState", "replaceState"];
    methods.forEach((method) => {
      const original = history[method];
      if (typeof original !== "function") {
        return;
      }

      history[method] = function patchedHistoryState() {
        const result = original.apply(this, arguments);
        handleRouteChange();
        return result;
      };
    });
  }

  document.documentElement.dataset.chatgptHelperLayout = layout;
  applyTheme(settings.DEFAULT_THEME);
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.layout) {
      settingsRevision += 1;
      applyLayout(changes.layout.newValue);
    }
    if (area === "local" && changes.theme) {
      themeRevision += 1;
      applyTheme(changes.theme.newValue);
    }
  });
  const initialRevision = settingsRevision;
  const initialThemeRevision = themeRevision;
  extensionApi.storage.local.get(["layout", "theme"]).then((values) => {
    if (settingsRevision === initialRevision) applyLayout(values.layout);
    if (themeRevision === initialThemeRevision) applyTheme(values.theme);
  }).catch(() => {
    console.warn("ChatGPT 目录：读取布局设置失败，使用默认布局。");
  });

  patchHistory();
  restartObserver();
  refreshQuestions();
  window.setTimeout(() => refreshQuestions(), 600);
  window.setTimeout(() => refreshQuestions(), 1800);

  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", handleScroll, { passive: true });
  window.addEventListener("resize", () => prepareContentSpace(true), { passive: true });
  window.addEventListener("popstate", handleRouteChange);
  window.setInterval(handleRouteChange, 1000);
})(globalThis);
