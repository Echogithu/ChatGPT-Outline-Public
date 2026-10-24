(function initSidebar(global) {
  const NAMESPACE = "__CHATGPT_HELPER__";
  const MAX_RAIL_MARKERS = 12;

  function makeIconButton(label, paths) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach((data) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", data);
      svg.appendChild(path);
    });
    button.appendChild(svg);
    return button;
  }

  class QuestionSidebar {
    constructor(options = {}) {
      this.options = options;
      this.items = [];
      this.activeId = null;
      this.expanded = false;
      this.root = null;
      this.rail = null;
      this.card = null;
      this.list = null;
      this.empty = null;
      this.railSegments = [];
      this.manualExpansion = new Map();
      this.treeSignature = null;
      this.pinned = false;
      this.merged = false;
    }

    mount(container) {
      if (this.root) {
        return this;
      }

      const root = document.createElement("aside");
      root.className = "chatgpt-helper-sidebar";
      root.setAttribute("aria-label", "问题目录");

      const hotspot = document.createElement("div");
      hotspot.className = "chatgpt-helper-sidebar__hotspot";
      hotspot.setAttribute("aria-hidden", "true");

      const rail = document.createElement("div");
      rail.className = "chatgpt-helper-sidebar__rail";

      const card = document.createElement("div");
      card.className = "chatgpt-helper-sidebar__card";

      const list = document.createElement("div");
      list.className = "chatgpt-helper-sidebar__list";

      const empty = document.createElement("div");
      empty.className = "chatgpt-helper-sidebar__empty";
      empty.textContent = "当前会话暂无可索引问题";

      const header = document.createElement("div");
      header.className = "chatgpt-helper-sidebar__header";
      const title = document.createElement("strong");
      title.textContent = "目录";
      const toolbar = document.createElement("div");
      toolbar.className = "chatgpt-helper-sidebar__toolbar";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "目录操作");
      const pin = makeIconButton("固定面板", ["M9 3h6v5l3 4v2H6v-2l3-4V3Z", "M12 14v7"]);
      pin.setAttribute("aria-pressed", "false");
      pin.addEventListener("click", () => {
        this.pinned = !this.pinned;
        this.updatePinButton();
        this.setExpanded(true);
      });
      const expandAll = makeIconButton("全部展开", ["M8 8l4-4 4 4", "M8 16l4 4 4-4"]);
      expandAll.addEventListener("click", () => {
        const groups = Array.from(this.list.querySelectorAll("[data-group-id]"));
        const open = !groups.every((group) => !group.querySelector(".chatgpt-helper-sidebar__children").hidden);
        groups.forEach((group) => {
          this.manualExpansion.set(group.dataset.groupId, open);
          this.syncExpansion(group, group.dataset.groupId);
        });
        this.updateExpandAllButton();
      });
      const top = makeIconButton("回到整个会话历史顶部", ["M5 4h14", "M7 12l5-5 5 5", "M12 7v13"]);
      const bottom = makeIconButton("回到整个会话历史底部", ["M5 20h14", "M7 12l5 5 5-5", "M12 4v13"]);
      top.addEventListener("click", () => this.options.onScrollBoundary?.("top"));
      bottom.addEventListener("click", () => this.options.onScrollBoundary?.("bottom"));
      const reload = makeIconButton("重新加载目录", ["M20 4v5h-5", "M4 20v-5h5", "M4.5 9a8 8 0 0 1 13.2-3L20 9", "M4 15l2.3 3A8 8 0 0 0 19.5 15"]);
      reload.addEventListener("click", () => this.options.onReload?.());
      toolbar.append(pin, expandAll, reload, top, bottom);
      header.append(title, toolbar);
      card.appendChild(header);
      this.pin = pin;
      this.title = title;
      this.expandAll = expandAll;
      const status = document.createElement("div");
      status.className = "chatgpt-helper-sidebar__status";
      status.setAttribute("role", "status");
      status.hidden = true;
      card.appendChild(status);
      this.status = status;
      const notice = document.createElement("section");
      notice.className = "chatgpt-helper-loading-notice";
      notice.setAttribute("aria-label", "加载全部目录");
      notice.hidden = true;
      const noticeCard = document.createElement("div");
      const noticeTitle = document.createElement("strong");
      noticeTitle.textContent = "正在加载全部目录";
      const explanation = document.createElement("p");
      explanation.textContent = "页面会自动滚动，收集历史问题和答案提纲。完成后会返回你刚才的阅读位置。";
      const progress = document.createElement("div");
      progress.setAttribute("role", "status");
      const stop = document.createElement("button");
      stop.type = "button";
      stop.textContent = "停止加载";
      stop.addEventListener("click", () => this.options.onStopLoading?.());
      noticeCard.append(noticeTitle, explanation, progress, stop);
      notice.appendChild(noticeCard);
      container.appendChild(notice);
      this.loadingNotice = notice;
      this.loadingProgress = progress;
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

      return this;
    }

    setExpanded(expanded) {
      const wasExpanded = this.expanded;
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
      if (this.expanded && !wasExpanded) this.options.onOpen?.();
    }

    setLoading(loading, text = "", showNotice = false) {
      this.root.dataset.loading = String(loading);
      this.status.textContent = text;
      this.status.hidden = !text;
      this.list.setAttribute("aria-busy", String(loading));
      this.loadingNotice.hidden = !loading || !showNotice;
      this.loadingProgress.textContent = showNotice ? text : "";
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

    render(items, activeId, merged = false) {
      if (!this.root || !this.rail || !this.list || !this.empty) {
        return;
      }

      const nextItems = Array.isArray(items) ? items.slice() : [];
      const signature = JSON.stringify([merged, nextItems.map((item) => [item.id, item.title,
        (item.answers || []).map((answer) => [answer.id, answer.headings.map((heading) => [heading.id, heading.text, heading.level])])
      ])]);
      this.items = nextItems;
      this.merged = merged;
      this.title.textContent = merged ? "目录" : "问题";
      this.root.setAttribute("aria-label", merged ? "会话目录" : "问题目录");
      this.expandAll.hidden = !merged;
      if (signature === this.treeSignature) {
        this.setActive(activeId);
        return;
      }
      this.treeSignature = signature;
      const previousScrollTop = this.list.scrollTop;
      this.activeId = activeId || null;
      this.railSegments = this.buildRailSegments();
      this.rail.replaceChildren();
      this.list.replaceChildren();

      if (!this.items.length) {
        this.root.dataset.visible = "false";
        this.empty.hidden = false;
        return;
      }

      this.root.dataset.visible = "true";
      this.empty.hidden = true;

      const fragment = document.createDocumentFragment();
      this.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chatgpt-helper-sidebar__item";
        button.dataset.questionId = item.id;
        button.title = item.title;
        button.textContent = item.title;
        button.addEventListener("click", () => {
          if (merged) {
            this.manualExpansion.set(item.id, true);
            this.syncExpansion(button.closest("[data-group-id]"), item.id);
            this.updateExpandAllButton();
          }
          this.options.onSelect?.(item);
        });
        if (!merged) {
          fragment.appendChild(button);
          return;
        }
        const group = document.createElement("div");
        group.className = "chatgpt-helper-sidebar__group";
        group.dataset.groupId = item.id;
        const row = document.createElement("div");
        row.className = "chatgpt-helper-sidebar__row";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "chatgpt-helper-sidebar__toggle";
        toggle.setAttribute("aria-label", `展开或收起：${item.title}`);
        const children = document.createElement("div");
        children.className = "chatgpt-helper-sidebar__children";
        children.id = `${item.id}-outline`;
        toggle.setAttribute("aria-controls", children.id);
        toggle.addEventListener("click", () => {
          this.manualExpansion.set(item.id, children.hidden);
          this.syncExpansion(group, item.id);
          this.updateExpandAllButton();
        });
        (item.answers || []).forEach((answer, answerIndex) => {
          if (item.answers.length > 1) {
            const label = document.createElement("div");
            label.className = "chatgpt-helper-sidebar__answer-label";
            label.textContent = `回答 ${answerIndex + 1}`;
            children.appendChild(label);
          }
          if (!answer.headings.length) {
            const jump = document.createElement("button");
            jump.type = "button";
            jump.className = "chatgpt-helper-sidebar__heading";
            jump.textContent = "跳到回答";
            jump.addEventListener("click", () => this.options.onSelectAnswer?.(answer, item));
            children.appendChild(jump);
          }
          const levels = [];
          answer.headings.forEach((heading) => {
            while (levels.length && levels[levels.length - 1] >= heading.level) levels.pop();
            const link = document.createElement("button");
            link.type = "button";
            link.className = "chatgpt-helper-sidebar__heading";
            link.dataset.headingId = heading.id;
            link.style.paddingLeft = `${16 + levels.length * 12}px`;
            link.title = heading.text;
            link.textContent = heading.text;
            link.addEventListener("click", () => this.options.onSelectHeading?.(heading, item));
            children.appendChild(link);
            levels.push(heading.level);
          });
        });
        if (!item.answers?.length) {
          const pending = document.createElement("div");
          pending.className = "chatgpt-helper-sidebar__answer-label";
          pending.textContent = "暂无回答";
          children.appendChild(pending);
        }
        row.append(toggle, button);
        group.append(row, children);
        fragment.appendChild(group);
        this.syncExpansion(group, item.id);
      });

      const railFragment = document.createDocumentFragment();
      this.railSegments.forEach((segment) => {
        const railButton = document.createElement("button");
        railButton.type = "button";
        railButton.className = "chatgpt-helper-sidebar__rail-item";
        railButton.dataset.segmentStart = String(segment.start);
        railButton.dataset.segmentEnd = String(segment.end);
        railButton.dataset.questionId = segment.item.id;
        railButton.title = segment.item.title;
        railButton.setAttribute("aria-label", segment.item.title);
        railButton.addEventListener("click", () => {
          this.setExpanded(true);
          this.pin.focus();
        });
        railFragment.appendChild(railButton);
      });

      this.rail.appendChild(railFragment);
      this.list.appendChild(fragment);
      this.setActive(this.activeId);
      this.list.scrollTop = previousScrollTop;
    }

    updatePinButton() {
      const label = this.pinned ? "取消固定" : "固定面板";
      this.pin.title = label;
      this.pin.setAttribute("aria-label", label);
      this.pin.setAttribute("aria-pressed", String(this.pinned));
    }

    updateExpandAllButton() {
      const groups = Array.from(this.list.querySelectorAll("[data-group-id]"));
      const allOpen = groups.length > 0 && groups.every((group) => !group.querySelector(".chatgpt-helper-sidebar__children").hidden);
      const label = allOpen ? "全部收起" : "全部展开";
      this.expandAll.title = label;
      this.expandAll.setAttribute("aria-label", label);
      this.expandAll.setAttribute("aria-pressed", String(allOpen));
      this.expandAll.querySelectorAll("path").forEach((path, index) => {
        path.setAttribute("d", allOpen
          ? ["M8 4l4 4 4-4", "M8 20l4-4 4 4"][index]
          : ["M8 8l4-4 4 4", "M8 16l4 4 4-4"][index]);
      });
    }

    syncExpansion(group, id) {
      const open = this.manualExpansion.has(id) ? this.manualExpansion.get(id) : id === this.activeId;
      group.querySelector(".chatgpt-helper-sidebar__children").hidden = !open;
      const toggle = group.querySelector(".chatgpt-helper-sidebar__toggle");
      toggle.textContent = open ? "▾" : "▸";
      toggle.setAttribute("aria-expanded", String(open));
    }

    resetTree() {
      this.manualExpansion.clear();
      this.treeSignature = null;
    }

    setActiveHeading(id) {
      this.list?.querySelectorAll("[data-heading-id]").forEach((button) => {
        const active = button.dataset.headingId === id;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "location");
        else button.removeAttribute("aria-current");
      });
    }

    setActive(id) {
      const previousActiveId = this.activeId;
      this.activeId = id || null;

      if (!this.list) {
        return;
      }

      this.list.querySelectorAll("[data-group-id]").forEach((group) => {
        this.syncExpansion(group, group.dataset.groupId);
      });
      const buttons = Array.from(this.list.querySelectorAll("[data-question-id]"));
      buttons.forEach((button) => {
        const isActive = button.dataset.questionId === this.activeId;
        button.classList.toggle("is-active", isActive);
        if (isActive) button.setAttribute("aria-current", "location");
        else button.removeAttribute("aria-current");

        if (isActive && previousActiveId !== this.activeId) {
          // 高亮同步只滚动目录列表，不让浏览器继续滚动外层会话。
          const itemRect = button.getBoundingClientRect();
          const listRect = this.list.getBoundingClientRect();
          if (itemRect.top < listRect.top) this.list.scrollTop += itemRect.top - listRect.top;
          else if (itemRect.bottom > listRect.bottom) this.list.scrollTop += itemRect.bottom - listRect.bottom;
        }
      });

      this.updateExpandAllButton();
      if (!this.rail) {
        return;
      }

      const activeIndex = this.items.findIndex((item) => item.id === this.activeId);
      const railButtons = Array.from(this.rail.querySelectorAll("[data-question-id]"));
      railButtons.forEach((button, index) => {
        const segment = this.railSegments[index];
        const isActive =
          activeIndex >= 0 &&
          Boolean(segment) &&
          activeIndex >= segment.start &&
          activeIndex <= segment.end;

        button.classList.toggle("is-active", isActive);
      });
    }
  }

  function mount(container, options) {
    const sidebar = new QuestionSidebar(options);
    return sidebar.mount(container);
  }

  global[NAMESPACE] = global[NAMESPACE] || {};
  global[NAMESPACE].sidebar = {
    mount,
    makeIconButton
  };
})(globalThis);
