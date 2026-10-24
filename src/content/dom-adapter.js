(function initDomAdapter(global) {
  const NAMESPACE = "__CHATGPT_HELPER__";
  const ITEM_ID_PREFIX = "chatgpt-helper-question";
  const MESSAGE_ID_PREFIX = "chatgpt-helper-message";
  const HEADING_ID_PREFIX = "chatgpt-helper-heading";
  let nextLocalTurnId = 0;
  // 只匹配 ChatGPT 用户消息的语义类，避免命中 bg-user-message 等样式类。
  const USER_MESSAGE_SELECTOR = "[class~='group/user-message']";
  const MESSAGE_LABEL_SELECTOR = "h1, h2, h3, h4, h5, h6, [aria-label]";
  const USER_MESSAGE_LABEL = /^(你说|您说|你问|用户|You said|You)\s*[:：]?$/i;
  const ASSISTANT_MESSAGE_LABEL = /^(ChatGPT\s*(?:说|said|says)|Assistant)\s*[:：]?$/i;
  const USER_EDIT_BUTTON_SELECTOR =
    "button[aria-label*='Edit'], button[aria-label*='编辑'], button[data-testid*='edit']";
  const USER_SELECTORS = [
    USER_MESSAGE_SELECTOR,
    "[data-message-author-role='user']",
    "[data-testid*='user-message']",
    "[data-testid*='conversation-turn-'][data-message-author-role='user']",
    "article [data-message-author-role='user']"
  ];
  const ASSISTANT_SELECTORS = [
    "[data-message-author-role='assistant']",
    "[data-testid*='assistant-message']",
    "[data-testid*='conversation-turn-'][data-message-author-role='assistant']",
    "article [data-message-author-role='assistant']"
  ];
  const KNOWN_CONVERSATION_ROUTE_PATTERNS = [
    /^\/c\/[^/]+/i,
    /^\/share\/[^/]+/i,
    /^\/projects?\/[^/]+(?:\/c\/[^/]+)?/i
  ];

  function getConversationRoot() {
    const roots = Array.from(document.querySelectorAll("main"));
    const visibleRoots = roots.filter(isVisibleConversationBlock);

    if (!visibleRoots.length) {
      return roots[0] || null;
    }

    return visibleRoots.reduce((largest, current) => {
      const largestRect = largest.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      return currentRect.width * currentRect.height > largestRect.width * largestRect.height
        ? current
        : largest;
    });
  }

  function hasKnownConversationRoute() {
    return KNOWN_CONVERSATION_ROUTE_PATTERNS.some((pattern) =>
      pattern.test(window.location.pathname)
    );
  }

  function isConversationRoute() {
    const root = getConversationRoot();
    if (!root) {
      return hasKnownConversationRoute();
    }

    if (hasKnownConversationRoute()) {
      return true;
    }

    return hasConversationContent(root);
  }

  function normalizeTitle(rawText) {
    const firstLine = (rawText || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    if (!firstLine) {
      return "未命名问题";
    }

    return firstLine
      .replace(/^(你说|您说|你问|用户|You said|You)\s*[:：]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "未命名问题";
  }

  function findTurnContainer(node) {
    if (!(node instanceof HTMLElement)) {
      return null;
    }

    return (
      node.closest("article") ||
      node.closest("[data-testid^='conversation-turn-']") ||
      node.closest("[data-message-id]") ||
      node.closest("[data-turn-key]") ||
      node
    );
  }

  function getTextLength(element) {
    return (element?.innerText || "").replace(/\s+/g, "").length;
  }

  function getMessageLabelText(element) {
    return (element.textContent?.trim() || element.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ");
  }

  // 新版 ChatGPT 用屏幕阅读器标题标出“你说”，其旁边是真正可见的用户消息。
  function getUserLabelCandidates(root) {
    const labels = Array.from(root.querySelectorAll(MESSAGE_LABEL_SELECTOR))
      .filter((element) => USER_MESSAGE_LABEL.test(getMessageLabelText(element)));

    return labels
      .map((label) => {
        let wrapper = label.parentElement;

        while (wrapper && wrapper !== root) {
          const siblings = Array.from(wrapper.children).filter((candidate) => {
            if (candidate === label || candidate.contains(label)) {
              return false;
            }

            if (!isVisibleConversationBlock(candidate) || !getTextLength(candidate)) {
              return false;
            }

            return (
              candidate.matches(USER_MESSAGE_SELECTOR) ||
              candidate.querySelector(USER_EDIT_BUTTON_SELECTOR)
            );
          });

          if (siblings.length === 1) {
            return siblings[0];
          }

          const semanticSibling = siblings.find((candidate) => {
            return candidate.matches(USER_MESSAGE_SELECTOR);
          });
          if (semanticSibling) {
            return semanticSibling;
          }

          wrapper = wrapper.parentElement;
        }

        return null;
      })
      .filter(Boolean);
  }

  function isVisibleConversationBlock(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.closest(".chatgpt-helper-sidebar")) {
      return false;
    }

    if (element.closest(".chatgpt-helper-message-outline")) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.height > 24 && rect.width > 120;
  }

  function looksLikeUserTurn(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const directRole = element.matches?.("[data-message-author-role='user']");
    const nestedRole = element.querySelector?.("[data-message-author-role='user']");
    const editButton = element.querySelector?.(
      "button[aria-label*='Edit'], button[aria-label*='编辑'], button[data-testid*='edit']"
    );
    const branchButton = element.querySelector?.(
      "button[aria-label*='Branch'], button[aria-label*='分支']"
    );
    const textLength = getTextLength(element);

    return (
      Boolean(directRole || nestedRole || editButton || branchButton) &&
      textLength > 0 &&
      isVisibleConversationBlock(element)
    );
  }

  // 判断节点是否像 AI 回复轮次。
  function looksLikeAssistantTurn(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const directRole = element.matches?.("[data-message-author-role='assistant']");
    const nestedRole = element.querySelector?.("[data-message-author-role='assistant']");
    const contentElement = findAssistantContentElement(element);

    return Boolean(directRole || nestedRole || contentElement) && isVisibleConversationBlock(element);
  }

  function getPrimaryCandidates(root) {
    const nodes = USER_SELECTORS.flatMap((selector) =>
      Array.from(root.querySelectorAll(selector))
    );

    return keepOutermostElements(nodes.map(findTurnContainer).filter(Boolean));
  }

  // 使用优先选择器查找 AI 回复候选节点。
  function getAssistantPrimaryCandidates(root) {
    const nodes = ASSISTANT_SELECTORS.flatMap((selector) =>
      Array.from(root.querySelectorAll(selector))
    );

    return nodes
      .map(findTurnContainer)
      .filter(Boolean);
  }

  // 当前 ChatGPT 用带散列后缀的 MarkdownRoot 类承载助手回复。
  function getAssistantMarkdownCandidates(root) {
    return Array.from(root.querySelectorAll("[class*='MarkdownRoot-']"));
  }

  // 新版 ChatGPT 用屏幕阅读器标题标出助手回复；向上找到承载 Markdown 的消息块。
  function getAssistantLabelCandidates(root) {
    const labels = Array.from(root.querySelectorAll(MESSAGE_LABEL_SELECTOR))
      .filter((element) => ASSISTANT_MESSAGE_LABEL.test(getMessageLabelText(element)));

    return labels
      .map((label) => {
        const turn = label.closest("article, [data-testid^='conversation-turn-'], [data-message-id], [data-turn-key]");
        let candidate = label.parentElement;

        while (candidate && candidate !== root) {
          // 空的流式回复不能越过本轮，或把标签之前的用户/助手正文当作自己的回复。
          if (turn && !turn.contains(candidate)) {
            break;
          }

          const contentElement = findAssistantContentElement(candidate);
          if (contentElement &&
              (label.compareDocumentPosition(contentElement) & Node.DOCUMENT_POSITION_FOLLOWING) &&
              isVisibleConversationBlock(contentElement)) {
            return candidate;
          }

          candidate = candidate.parentElement;
        }

        return null;
      })
      .filter(Boolean);
  }

  // 在优先选择器失效时回退扫描 article 节点。
  function getAssistantFallbackCandidates(root) {
    return Array.from(root.querySelectorAll("article")).filter((article) => {
      return looksLikeAssistantTurn(article);
    });
  }

  // 使用启发式规则兜底识别 AI 回复节点。
  function getAssistantHeuristicCandidates(root) {
    const candidates = Array.from(
      root.querySelectorAll("[data-testid^='conversation-turn-'], [data-message-id], article, section")
    );

    return candidates.filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      if (looksLikeUserTurn(element) || !looksLikeAssistantTurn(element)) {
        return false;
      }

      return isVisibleConversationBlock(element);
    });
  }

  function getFallbackCandidates(root) {
    return Array.from(root.querySelectorAll("article")).filter((article) => {
      return looksLikeUserTurn(article);
    });
  }

  function getHeuristicCandidates(root) {
    const candidates = Array.from(
      root.querySelectorAll("[data-testid^='conversation-turn-'], [data-message-id], article, section")
    );

    return candidates.filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      if (!looksLikeUserTurn(element)) {
        return false;
      }

      return isVisibleConversationBlock(element);
    });
  }

  function dedupeElements(elements) {
    const seen = new Set();
    const deduped = [];

    elements.forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      if (seen.has(element)) {
        return;
      }

      seen.add(element);
      deduped.push(element);
    });

    return deduped;
  }

  function keepOutermostElements(elements) {
    const candidates = dedupeElements(elements);
    return candidates.filter((candidate) => {
      return !candidates.some((other) => other !== candidate && other.contains(candidate));
    });
  }

  function extractQuestionText(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }

    const contentSelectors = [
      "[data-message-author-role='user'] .whitespace-pre-wrap",
      "[data-message-author-role='user'] [class*='whitespace-pre-wrap']",
      "[data-message-author-role='user'] [data-testid='user-message']",
      "[data-message-author-role='user'] [dir='auto']",
      "[data-message-author-role='user'] .markdown",
      "[data-message-author-role='user'] .prose",
      "[data-message-author-role='user'] p",
      "[class*='user-message'] [dir='auto']",
      "[class*='user-message'] [class*='whitespace-pre-wrap']",
      "[class*='user-message'] p",
      "[data-testid*='user-message'] .whitespace-pre-wrap",
      "[data-testid*='user-message'] [class*='whitespace-pre-wrap']",
      "[data-testid*='user-message'] [dir='auto']",
      "[data-testid*='user-message'] .markdown",
      "[data-testid*='user-message'] .prose",
      "[data-testid*='conversation-turn-'] [dir='auto']",
      "[data-testid*='conversation-turn-'] .markdown",
      "[data-message-id] [dir='auto']",
      "[data-message-id] .markdown",
      "[data-message-id] .prose"
    ];

    for (const selector of contentSelectors) {
      const matched = Array.from(element.querySelectorAll(selector))
        .map((node) => node.textContent?.trim() || "")
        .find((text) => text && !/^(你说|您说|你问|用户|You said|You)\s*[:：]?$/i.test(text));

      if (matched) {
        return matched;
      }
    }

    const cleanedLines = (element.innerText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(你说|您说|你问|用户|You said|You)\s*[:：]?$/i.test(line))
      .filter((line) => !/^(编辑消息|Edit message|复制|Copy|赞|踩|重新生成|Regenerate)$/i.test(line));

    return cleanedLines[0] || "";
  }

  // 查找 AI 回复中承载 Markdown 内容的元素。
  function findAssistantContentElement(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    if (element.matches("[class*='MarkdownRoot-']")) {
      return element;
    }

    const selectors = [
      "[data-message-author-role='assistant'] [class*='MarkdownRoot-']",
      "[class*='MarkdownRoot-']",
      "[data-message-author-role='assistant'] .markdown",
      "[data-message-author-role='assistant'] .prose",
      "[data-message-author-role='assistant'] [class*='markdown']",
      "[data-message-author-role='assistant'] [class*='prose']",
      ".markdown",
      ".prose"
    ];

    for (const selector of selectors) {
      const matched = element.querySelector(selector);
      if (matched instanceof HTMLElement) {
        return matched;
      }
    }

    const roleElement = element.matches("[data-message-author-role='assistant']")
      ? element
      : element.querySelector("[data-message-author-role='assistant']");

    return roleElement instanceof HTMLElement ? roleElement : null;
  }


  function collectCandidateElements(root) {
    if (!(root instanceof HTMLElement)) {
      return [];
    }

    const primary = getPrimaryCandidates(root);
    const labeled = primary.length ? [] : getUserLabelCandidates(root);
    const fallback = primary.length || labeled.length ? [] : getFallbackCandidates(root);
    const heuristic = primary.length || labeled.length || fallback.length
      ? []
      : getHeuristicCandidates(root);
    return dedupeElements(
      primary.length ? primary : labeled.length ? labeled : fallback.length ? fallback : heuristic
    );
  }

  // 汇总并去重 AI 回复候选节点。
  function collectAssistantCandidateElements(root) {
    if (!(root instanceof HTMLElement)) {
      return [];
    }

    const primary = getAssistantPrimaryCandidates(root);
    if (primary.length) {
      return dedupeElements(primary);
    }

    const labeled = getAssistantLabelCandidates(root);
    if (labeled.length) {
      return dedupeElements(labeled);
    }

    const markdown = getAssistantMarkdownCandidates(root);
    if (markdown.length) {
      return dedupeElements(markdown);
    }

    const fallback = getAssistantFallbackCandidates(root);
    const candidates = fallback.length ? fallback : getAssistantHeuristicCandidates(root);
    return dedupeElements(candidates);
  }

  function hasConversationContent(root) {
    return collectCandidateElements(root).length > 0;
  }

  function buildQuestionItems() {
    const root = getConversationRoot();
    if (!root) {
      return [];
    }

    const candidates = collectCandidateElements(root);
    if (!candidates.length) {
      return [];
    }

    return candidates
      .map((element, index) => {
        const id = getStableTurnId(element, ITEM_ID_PREFIX, "chatgptHelperQuestionId");

        return {
          id,
          title: normalizeTitle(extractQuestionText(element)),
          element,
          index
        };
      })
      .filter((item) => item.title);
  }

  function getQuestionItems() {
    return buildQuestionItems();
  }

  // 原生消息 ID 在重新渲染后仍可定位；没有原生身份时只给当前 DOM 分配唯一身份，绝不复用序号。
  function getStableTurnId(element, prefix, datasetKey) {
    // data-testid 的轮次序号会重排，不能作为消息身份。
    const sourceId = element.getAttribute("data-message-id") ||
      element.querySelector("[data-message-id]")?.getAttribute("data-message-id") ||
      element.closest("[data-turn-key]")?.getAttribute("data-turn-key");
    if (sourceId) {
      const id = `${prefix}-source-${encodeURIComponent(sourceId)}`;
      element.dataset[datasetKey] = id;
      return id;
    }
    const cached = element.dataset[datasetKey];
    if (cached?.startsWith(`${prefix}-local-`)) return cached;
    const id = `${prefix}-local-${++nextLocalTurnId}`;
    element.dataset[datasetKey] = id;
    return id;
  }

  function getStableMessageId(element) {
    return getStableTurnId(element, MESSAGE_ID_PREFIX, "chatgptHelperMessageId");
  }

  // 获取当前会话中可建立大纲的 AI 回复消息。
  function getAssistantMessages() {
    const root = getConversationRoot();
    if (!root) {
      return [];
    }

    return collectAssistantCandidateElements(root)
      .map((element, index) => {
        const contentElement = findAssistantContentElement(element);
        if (!contentElement) {
          return null;
        }

        return {
          id: getStableMessageId(element, index),
          element,
          contentElement,
          index
        };
      })
      .filter(Boolean);
  }

  // 按页面顺序关联回复，兼容一次提问对应多段回复及尚未回复的提问。
  function getQuestionGroups(questions = getQuestionItems(), messages = getAssistantMessages()) {
    const groups = questions.map((question) => ({ ...question, answers: [] }));
    const turns = [
      ...groups.map((group) => ({ element: group.element, group })),
      ...messages.map((message) => ({ element: message.element, message }))
    ].sort((first, second) => {
      if (first.element === second.element) return 0;
      return first.element.compareDocumentPosition(second.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    let current = null;
    turns.forEach((turn) => {
      if (turn.group) current = turn.group;
      else if (current) current.answers.push({
        ...turn.message,
        headings: extractHeadings(turn.message.contentElement, turn.message.id)
      });
    });
    return groups;
  }

  function assignHeadingId(element, messageId, index) {
    if (!element.id) {
      const base = `${HEADING_ID_PREFIX}-${messageId}-${index + 1}`;
      let id = base;
      let suffix = 1;
      // 前插标题不能占用旧节点的锚点；保留旧身份，给新增节点分配空闲 ID。
      while (document.getElementById(id)) id = `${base}-${suffix++}`;
      element.id = id;
    }

    return element.id;
  }

  function buildHeadingItem(element, messageId, index, level, text) {
    const normalizedText = (text || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!normalizedText) {
      return null;
    }

    return {
      id: assignHeadingId(element, messageId, index),
      messageId,
      level,
      text: normalizedText,
      element,
      index
    };
  }

  // 提取 AI 回复内 h1-h6 标题并补齐稳定锚点。
  function extractHeadings(contentElement, messageId = "message") {
    if (!(contentElement instanceof HTMLElement)) {
      return [];
    }

    const headingItems = Array.from(contentElement.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .map((element, index) => {
        return buildHeadingItem(
          element,
          messageId,
          index,
          Number(element.tagName.slice(1)),
          element.textContent
        );
      })
      .filter(Boolean);

    if (headingItems.length) {
      return headingItems;
    }

    // ChatGPT 有时将标题渲染为独占一行的加粗段落。
    return Array.from(contentElement.querySelectorAll("p"))
      .map((paragraph, index) => {
        const text = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 120) {
          return null;
        }

        const isStandaloneEmphasis = Array.from(paragraph.querySelectorAll("strong, b"))
          .some((element) => {
            const emphasizedText = (element.textContent || "").replace(/\s+/g, " ").trim();
            return emphasizedText === text;
          });

        if (!isStandaloneEmphasis) {
          return null;
        }

        return buildHeadingItem(paragraph, messageId, index, 2, text);
      })
      .filter(Boolean);
  }

  function isScrollable(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight;
  }

  function findScrollContainer(element) {
    let current = element?.parentElement || null;

    while (current) {
      if (isScrollable(current)) {
        return current;
      }

      current = current.parentElement;
    }

    const fallback = document.scrollingElement;
    return fallback instanceof HTMLElement ? fallback : null;
  }

  function getScrollContainer() {
    const root = getConversationRoot();
    if (root instanceof HTMLElement) {
      // 从所有问答的共同父节点向上寻找，支持 main 内的历史滚动层，避开单条回答的局部滚动。
      const messages = [
        ...getQuestionItems().map((item) => item.element),
        ...getAssistantMessages().map((item) => item.element)
      ].filter((element) => root.contains(element));
      let common = messages[0]?.parentElement || root;
      while (common && !messages.every((element) => common.contains(element))) {
        common = common.parentElement;
      }
      if (common && root.contains(common)) {
        if (isScrollable(common)) return common;
        return findScrollContainer(common);
      }
      if (isScrollable(root)) return root;
      return findScrollContainer(root);
    }

    const fallback = document.scrollingElement;
    return fallback instanceof HTMLElement ? fallback : null;
  }

  // ChatGPT 的反向 flex 历史底部为 0，顶部为负值；对调用方统一为从顶部起的距离。
  function getScrollMetrics(container) {
    const length = Math.max(0, container.scrollHeight - container.clientHeight);
    const style = window.getComputedStyle(container);
    const reversed = style.display.includes("flex") && style.flexDirection === "column-reverse";
    const start = reversed ? -length : 0;
    return { length, start, end: start + length,
      position: Math.max(0, Math.min(length, container.scrollTop - start)) };
  }

  function scrollToPosition(container, position) {
    const metrics = getScrollMetrics(container);
    container.scrollTo({ top: metrics.start + Math.max(0, Math.min(metrics.length, position)), behavior: "instant" });
  }

  // 滚动整段会话历史，不滚动目录或单条回答；scrollTo 自动限制到历史边界。
  function scrollToBoundary(boundary) {
    if (boundary !== "top" && boundary !== "bottom") return false;
    const container = getScrollContainer();
    if (!container) return false;
    // 历史层可能嵌套在另一个可滚动页面中；从内向外到达整页首尾，避免外层位置不变。
    let current = container;
    while (current instanceof HTMLElement) {
      scrollToPosition(current, boundary === "top" ? 0 : getScrollMetrics(current).length);
      current = current.parentElement;
    }
    const pageMetrics = document.scrollingElement ? getScrollMetrics(document.scrollingElement) : { start: 0, end: 0 };
    window.scrollTo({
      top: boundary === "top" ? pageMetrics.start : pageMetrics.end,
      behavior: "instant"
    });
    return true;
  }

  function scrollElementWithOffset(target, options = {}) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const topOffset = Number(options.topOffset) || 96;
    const behavior = options.behavior || "smooth";
    const previousScrollMarginTop = target.style.scrollMarginTop;
    target.style.scrollMarginTop = `${topOffset}px`;
    target.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior
    });
    target.style.scrollMarginTop = previousScrollMarginTop;
    return true;
  }

  function scrollToQuestion(id) {
    const root = getConversationRoot();
    const target = root?.querySelector(
      `[data-chatgpt-helper-question-id='${CSS.escape(id)}']`
    );

    if (!target) {
      return false;
    }

    return scrollElementWithOffset(target, { behavior: "auto" });
  }

  // 仅在指定回答内解析实时标题；目标消失时停止，禁止去其他回答找同名标题。
  function findCurrentHeadingTarget(message, heading) {
    const headings = extractHeadings(message.contentElement, message.id);
    const matchingText = headings.filter((item) => item.text === heading.text && item.level === heading.level);
    // 原节点已消失时，按位置生成的锚点不能消除重复标题的歧义。
    if (!heading.id.startsWith(`${HEADING_ID_PREFIX}-`)) {
      const exact = matchingText.filter((item) => item.id === heading.id);
      if (exact.length === 1) return exact[0].element;
    }
    return matchingText.length === 1 ? matchingText[0].element : null;
  }

  function scrollToHeading(id, fallbackElement, heading) {
    const root = getConversationRoot();
    let target = null;
    if (heading) {
      const message = getAssistantMessages().find((item) => item.id === heading.messageId);
      if (!message) return false;
      // 优先保留用户点击的真实节点，避免流式插入标题导致位置序号变化。
      target = fallbackElement instanceof HTMLElement && message.contentElement.contains(fallbackElement)
        ? fallbackElement
        : findCurrentHeadingTarget(message, heading);
    } else {
      target = fallbackElement instanceof HTMLElement && root?.contains(fallbackElement)
        ? fallbackElement
        : id ? root?.querySelector(`#${CSS.escape(id)}`) : null;
    }
    if (!(target instanceof HTMLElement) || !root?.contains(target)) return false;
    return scrollElementWithOffset(target, { behavior: "auto" });
  }

  function observeQuestions(onChange) {
    const root = getConversationRoot() || document.body;
    if (!root || typeof onChange !== "function") {
      return () => {};
    }

    let frameId = 0;
    let lastSignature = getQuestionItems()
      .map((item) => `${item.id}:${item.title}`)
      .join("|");

    const observer = new MutationObserver(() => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = 0;
        const nextItems = getQuestionItems();
        const nextSignature = nextItems
          .map((item) => `${item.id}:${item.title}`)
          .join("|");

        if (nextSignature === lastSignature) {
          return;
        }

        lastSignature = nextSignature;
        onChange(nextItems);
      });
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      observer.disconnect();
    };
  }

  // 生成 AI 回复标题签名，用于判断是否需要刷新大纲。
  function getAssistantHeadingSignature() {
    return getAssistantMessages()
      .map((message) => {
        const headings = extractHeadings(message.contentElement, message.id);
        return `${message.id}:${headings
          .map((heading) => `${heading.id}:${heading.level}:${heading.text}`)
          .join(",")}`;
      })
      .join("|");
  }

  // 监听 AI 回复内容变化，支持流式输出时刷新大纲。
  function observeAssistantMessages(onChange) {
    const root = getConversationRoot() || document.body;
    if (!root || typeof onChange !== "function") {
      return () => {};
    }

    let frameId = 0;
    let lastSignature = getAssistantHeadingSignature();

    const observer = new MutationObserver(() => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = 0;
        const nextSignature = getAssistantHeadingSignature();

        if (nextSignature === lastSignature) {
          return;
        }

        lastSignature = nextSignature;
        onChange();
      });
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      observer.disconnect();
    };
  }

  global[NAMESPACE] = global[NAMESPACE] || {};
  global[NAMESPACE].domAdapter = {
    extractHeadings,
    getAssistantMessages,
    getConversationRoot,
    getQuestionItems,
    getQuestionGroups,
    getScrollContainer,
    getScrollMetrics,
    scrollToPosition,
    observeAssistantMessages,
    observeQuestions,
    scrollToHeading,
    scrollToBoundary,
    scrollToQuestion,
    isConversationRoute
  };
})(globalThis);
