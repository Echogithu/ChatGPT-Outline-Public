(function initMessageOutline(global) {
  const NAMESPACE = "__CHATGPT_HELPER__";
  const MAX_RAIL_MARKERS = 18;

  function getHeadingSignature(headings) {
    return headings
      .map((heading) => `${heading.id}:${heading.level}:${heading.text}`)
      .join("|");
  }

  class MessageOutline {
    constructor(options = {}) {
      this.options = options;
      this.items = [];
      this.messageId = null;
      this.expanded = false;
      this.pinned = false;
      this.root = null;
      this.rail = null;
      this.card = null;
      this.list = null;
      this.empty = null;
      this.railSegments = [];
      this.positionFrameId = 0;
      this.positionIntervalId = 0;
      this.positionObserver = null;
      this.handlePositionEvent = () => {
        this.updatePosition();
        this.trackPositionDuringSidebarTransition();
      };
    }

    /** 挂载全局消息大纲卡尺。 */
    mount(container) {
      if (this.root) {
        return this;
      }

      const root = document.createElement("aside");
      root.className = "chatgpt-helper-message-outline";
      root.setAttribute("aria-label", "回答目录");

      const hotspot = document.createElement("div");
      hotspot.className = "chatgpt-helper-message-outline__hotspot";
      hotspot.setAttribute("aria-hidden", "true");

      const rail = document.createElement("div");
      rail.className = "chatgpt-helper-message-outline__rail";

      const card = document.createElement("div");
      card.className = "chatgpt-helper-message-outline__card";

      const list = document.createElement("div");
      list.className = "chatgpt-helper-message-outline__list";

      const empty = document.createElement("div");
      empty.className = "chatgpt-helper-message-outline__empty";
      empty.textContent = "当前回复暂无可索引标题";

      const header = document.createElement("div");
      header.className = "chatgpt-helper-sidebar__header";
      const title = document.createElement("strong");
      title.textContent = "回答";
      const toolbar = document.createElement("div");
      toolbar.className = "chatgpt-helper-sidebar__toolbar";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "回答目录操作");
      const makeIconButton = global[NAMESPACE].sidebar.makeIconButton;
      this.pin = makeIconButton("固定面板", ["M9 3h6v5l3 4v2H6v-2l3-4V3Z", "M12 14v7"]);
      this.pin.setAttribute("aria-pressed", "false");
      this.pin.addEventListener("click", () => {
        this.pinned = !this.pinned;
        this.updatePinButton();
        this.setExpanded(true);
      });
      const top = makeIconButton("回到整个会话历史顶部", ["M5 4h14", "M7 12l5-5 5 5", "M12 7v13"]);
      const bottom = makeIconButton("回到整个会话历史底部", ["M5 20h14", "M7 12l5 5 5-5", "M12 4v13"]);
      top.addEventListener("click", () => this.options.onScrollBoundary?.("top"));
      bottom.addEventListener("click", () => this.options.onScrollBoundary?.("bottom"));
      toolbar.append(this.pin, top, bottom);
      header.append(title, toolbar);
      card.appendChild(header);
      card.appendChild(list);
      card.appendChild(empty);
      root.appendChild(hotspot);
      root.appendChild(rail);
      root.appendChild(card);
      container.appendChild(root);

      rail.addEventListener("mouseenter", () => {
        this.setExpanded(true);
      });

      rail.addEventListener("mouseleave", (event) => {
        if (!card.contains(event.relatedTarget)) {
          this.setExpanded(false);
        }
      });

      card.addEventListener("mouseenter", () => {
        this.setExpanded(true);
      });

      card.addEventListener("mouseleave", (event) => {
        if (!rail.contains(event.relatedTarget)) {
          this.setExpanded(false);
        }
      });

      root.addEventListener("mouseleave", () => {
        this.setExpanded(false);
      });
      card.addEventListener("focusin", () => this.setExpanded(true));
      card.addEventListener("focusout", () => {
        queueMicrotask(() => {
          if (!root.matches(":hover")) this.setExpanded(false);
        });
      });
      root.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        this.pinned = false;
        this.updatePinButton();
        document.activeElement?.blur();
        this.setExpanded(false);
        rail.querySelector("button")?.focus();
      });

      this.root = root;
      this.rail = rail;
      this.card = card;
      this.list = list;
      this.empty = empty;
      this.setExpanded(false);
      this.updatePosition();
      this.observePosition();

      return this;
    }

    /** 根据 ChatGPT 原生左侧边栏宽度更新卡尺位置。 */
    updatePosition() {
      if (!this.root) {
        return;
      }

      const sidebar = Array.from(document.querySelectorAll("nav, aside"))
        .filter((element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          if (element.closest(".chatgpt-helper-message-outline, .chatgpt-helper-sidebar")) {
            return false;
          }

          const rect = element.getBoundingClientRect();
          if (rect.left > 4 || rect.right <= 48 || rect.right >= window.innerWidth * 0.45) {
            return false;
          }

          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
            return false;
          }

          return this.isElementActuallyOccupyingLeftSide(element, rect);
        })
        .map((element) => element.getBoundingClientRect())
        .sort((first, second) => second.right - first.right)[0];
      const left = sidebar ? Math.round(sidebar.right) : 0;
      const nextLeft = `${left}px`;
      const questions = document.querySelector(".chatgpt-helper-sidebar");
      if (questions && questions.style.getPropertyValue("--chatgpt-helper-left") !== nextLeft) {
        questions.style.setProperty("--chatgpt-helper-left", nextLeft);
      }
      if (this.root.style.getPropertyValue("--chatgpt-helper-message-outline-left") !== nextLeft) {
        this.root.style.setProperty("--chatgpt-helper-message-outline-left", nextLeft);
      }
    }

    isElementActuallyOccupyingLeftSide(element, rect) {
      const sampleY = Math.min(Math.max(window.innerHeight / 2, rect.top + 8), rect.bottom - 8);
      const sampleXs = [
        Math.max(rect.left + 8, 8),
        Math.max(Math.min(rect.right - 8, rect.left + rect.width / 2), 8)
      ];

      return sampleXs.some((sampleX) => {
        const stack = document.elementsFromPoint(sampleX, sampleY);
        const firstPageElement = stack.find((node) => {
          return !node.closest?.(".chatgpt-helper-message-outline, .chatgpt-helper-sidebar");
        });

        return firstPageElement === element || element.contains(firstPageElement);
      });
    }

    schedulePositionUpdate() {
      if (this.positionFrameId) {
        cancelAnimationFrame(this.positionFrameId);
      }

      this.positionFrameId = requestAnimationFrame(() => {
        this.positionFrameId = 0;
        this.updatePosition();
      });
    }

    trackPositionDuringSidebarTransition() {
      if (this.positionIntervalId) {
        window.clearInterval(this.positionIntervalId);
      }

      const startedAt = Date.now();
      this.positionIntervalId = window.setInterval(() => {
        this.updatePosition();

        if (Date.now() - startedAt > 420) {
          window.clearInterval(this.positionIntervalId);
          this.positionIntervalId = 0;
        }
      }, 32);
    }

    observePosition() {
      window.addEventListener("resize", this.handlePositionEvent, { passive: true });
      document.addEventListener("pointerdown", this.handlePositionEvent, true);
      document.addEventListener("click", this.handlePositionEvent, true);
      this.positionObserver = new MutationObserver((mutations) => {
        const onlyHelperMutations = mutations.every((mutation) => {
          const target = mutation.target;
          return target instanceof HTMLElement && target.closest(".chatgpt-helper-message-outline, .chatgpt-helper-sidebar");
        });

        if (onlyHelperMutations) {
          return;
        }

        this.schedulePositionUpdate();
      });
      this.positionObserver.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["class", "style", "data-state", "aria-expanded"]
      });
    }

    setExpanded(expanded) {
      this.expanded = this.pinned || Boolean(expanded) || Boolean(this.card?.contains(document.activeElement));

      if (this.root) {
        this.root.dataset.expanded = this.expanded ? "true" : "false";
      }

      this.rail?.setAttribute("aria-hidden", this.expanded ? "true" : "false");
      this.card?.setAttribute("aria-hidden", this.expanded ? "false" : "true");
      if (this.rail) {
        this.rail.inert = this.expanded;
      }
      if (this.card) {
        this.card.inert = !this.expanded;
      }
    }

    updatePinButton() {
      const label = this.pinned ? "取消固定" : "固定面板";
      this.pin.title = label;
      this.pin.setAttribute("aria-label", label);
      this.pin.setAttribute("aria-pressed", String(this.pinned));
    }

    buildRailSegments() {
      const total = this.items.length;
      if (!total) {
        return [];
      }

      const markerCount = Math.min(total, MAX_RAIL_MARKERS);
      const segmentSize = Math.ceil(total / markerCount);
      const segments = [];

      for (let markerIndex = 0; markerIndex < markerCount; markerIndex += 1) {
        const start = markerIndex * segmentSize;
        const end = Math.min(start + segmentSize - 1, total - 1);
        const item = this.items[start];

        if (!item) {
          continue;
        }

        segments.push({
          start,
          end,
          item
        });
      }

      return segments;
    }

    /** 渲染当前 AI 回复的 h1-h6 标题列表。 */
    render(message, headings) {
      if (!this.root || !this.rail || !this.list || !this.empty) {
        return;
      }

      const nextMessageId = message?.id || null;
      const nextItems = Array.isArray(headings) ? headings.slice() : [];
      const nextSignature = getHeadingSignature(nextItems);
      const shouldReuseList = nextMessageId === this.messageId && nextSignature === this.signature;

      this.messageId = nextMessageId;
      this.items = nextItems;
      this.railSegments = this.buildRailSegments();

      if (!this.messageId || !this.items.length) {
        this.root.dataset.visible = "false";
        this.empty.hidden = false;
        this.setExpanded(false);
        return;
      }

      this.root.dataset.visible = "true";
      this.empty.hidden = true;

      if (shouldReuseList) {
        return;
      }

      const previousScrollTop = this.list.scrollTop;
      const wasExpanded = this.expanded;
      this.signature = nextSignature;
      this.rail.replaceChildren();
      this.list.replaceChildren();

      const railFragment = document.createDocumentFragment();
      this.railSegments.forEach((segment) => {
        const railButton = document.createElement("button");
        railButton.type = "button";
        railButton.className = "chatgpt-helper-message-outline__rail-item";
        railButton.dataset.headingId = segment.item.id;
        railButton.title = segment.item.text;
        railButton.setAttribute("aria-label", segment.item.text);
        railButton.addEventListener("click", () => {
          this.setExpanded(true);
          this.pin.focus();
          const currentItem = this.items.find((item) => item.id === railButton.dataset.headingId);
          if (currentItem) {
            this.options.onSelect?.(currentItem);
          }
        });
        railFragment.appendChild(railButton);
      });

      const listFragment = document.createDocumentFragment();
      this.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chatgpt-helper-message-outline__item";
        button.dataset.headingId = item.id;
        button.dataset.level = String(Math.min(Math.max(item.level, 1), 6));
        button.title = item.text;
        button.textContent = item.text;
        button.addEventListener("click", () => {
          const currentItem = this.items.find((candidate) => candidate.id === button.dataset.headingId);
          if (currentItem) {
            this.options.onSelect?.(currentItem);
          }
        });
        listFragment.appendChild(button);
      });

      this.rail.appendChild(railFragment);
      this.list.appendChild(listFragment);

      if (wasExpanded) {
        this.setExpanded(true);
        this.list.scrollTop = previousScrollTop;
      }
    }

    setActiveHeading(id) {
      this.root?.querySelectorAll("[data-heading-id]").forEach((button) => {
        const active = button.dataset.headingId === id;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "location");
        else button.removeAttribute("aria-current");
      });
    }

    destroy() {
      if (this.positionFrameId) {
        cancelAnimationFrame(this.positionFrameId);
        this.positionFrameId = 0;
      }

      if (this.positionIntervalId) {
        window.clearInterval(this.positionIntervalId);
        this.positionIntervalId = 0;
      }

      this.positionObserver?.disconnect();
      this.positionObserver = null;
      window.removeEventListener("resize", this.handlePositionEvent);
      document.removeEventListener("pointerdown", this.handlePositionEvent, true);
      document.removeEventListener("click", this.handlePositionEvent, true);
      this.root?.remove();
      this.root = null;
      this.rail = null;
      this.card = null;
      this.list = null;
      this.empty = null;
      this.items = [];
      this.messageId = null;
    }
  }

  function mount(container, options) {
    const outline = new MessageOutline(options);
    return outline.mount(container);
  }

  global[NAMESPACE] = global[NAMESPACE] || {};
  global[NAMESPACE].messageOutline = {
    mount
  };
})(globalThis);
