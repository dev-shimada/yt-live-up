/**
 * YouTube の左サイドバー（ガイド）で配信中のチャンネルを上に移動する
 * ページコンテキストで実行される（content.ts から注入）
 *
 * line-end-style 属性の値:
 *   "none"  — 通常
 *   "dot"   — 新しいコンテンツあり
 *   "badge" — 配信中
 *
 * 折りたたみ内のチャンネルは遅延読み込みのため、
 * 「もっと見る」をプログラムでクリックして展開→ソート→折りたたむ
 */

const LOG_PREFIX = "[yt-live-up]";

function findSubscriptionsSection(): Element | null {
  const sections = document.querySelectorAll("ytd-guide-section-renderer");

  for (const section of Array.from(sections)) {
    const headerLink = section.querySelector(
      'ytd-guide-collapsible-section-entry-renderer a[href="/feed/subscriptions"]'
    );
    if (headerLink) return section;

    const headerEntry = section.querySelector(
      "ytd-guide-collapsible-section-entry-renderer ytd-guide-entry-renderer[is-header]"
    );
    if (headerEntry) {
      const titleEl = headerEntry.querySelector("yt-formatted-string.title");
      const text = titleEl?.textContent?.trim() ?? "";
      if (text === "登録チャンネル" || text === "Subscriptions") {
        return section;
      }
    }
  }

  return null;
}

function getVisibleEntries(items: Element): HTMLElement[] {
  const entries: HTMLElement[] = [];
  for (const child of Array.from(items.children)) {
    if (
      child.tagName.toLowerCase() === "ytd-guide-entry-renderer" &&
      !child.hasAttribute("is-header")
    ) {
      entries.push(child as HTMLElement);
    }
  }
  return entries;
}

function getCollapsedEntries(items: Element): HTMLElement[] {
  const expandableItems = items.querySelector(
    "ytd-guide-collapsible-entry-renderer #expandable-items"
  );
  if (!expandableItems) return [];

  const entries: HTMLElement[] = [];
  for (const child of Array.from(expandableItems.children)) {
    if (child.tagName.toLowerCase() === "ytd-guide-entry-renderer") {
      entries.push(child as HTMLElement);
    }
  }
  return entries;
}

function isLiveEntry(entry: HTMLElement): boolean {
  return entry.getAttribute("line-end-style") === "badge";
}

let observer: MutationObserver | null = null;
let observeTarget: Element | null = null;
let isSorting = false;

function startObserving(): void {
  if (observer && observeTarget) {
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["line-end-style"],
    });
  }
}

function stopObserving(): void {
  if (observer) observer.disconnect();
}

function expandAndSort(): void {
  if (isSorting) return;
  isSorting = true;
  stopObserving();

  try {
    const section = findSubscriptionsSection();
    if (!section) return;

    const items = section.querySelector("#items");
    if (!items) return;

    const collapsibleEntry = items.querySelector(
      "ytd-guide-collapsible-entry-renderer"
    );

    // 折りたたみセクションがなければ、表示中のみでソート
    if (!collapsibleEntry) {
      sortVisibleOnly(items);
      return;
    }

    // 折りたたみ内のエントリがまだ読み込まれていないか確認
    const expandableItems = collapsibleEntry.querySelector("#expandable-items");
    const collapsedCount = expandableItems
      ? expandableItems.querySelectorAll("ytd-guide-entry-renderer").length
      : 0;

    if (collapsedCount === 0) {
      // 「もっと見る」をクリックして展開
      // click 中に YouTube が requestStorageAccessFor を呼ぶのを抑制
      const origRSAF = (document as any).requestStorageAccessFor;
      (document as any).requestStorageAccessFor = () => Promise.resolve();

      const expanderLink = collapsibleEntry.querySelector(
        "#expander-item a"
      ) as HTMLElement | null;

      if (expanderLink) {
        expanderLink.click();

        // 展開後にエントリが読み込まれるのを待つ
        const waitForExpand = new MutationObserver(() => {
          const loaded = expandableItems
            ? expandableItems.querySelectorAll("ytd-guide-entry-renderer").length
            : 0;

          if (loaded > 0) {
            waitForExpand.disconnect();
            sortWithCollapsed(items, collapsibleEntry);
            // 折りたたむ
            const collapserLink = collapsibleEntry.querySelector(
              "#collapser-item a"
            ) as HTMLElement | null;
            if (collapserLink) {
              collapserLink.click();
            }
            // requestStorageAccessFor を復元
            if (origRSAF) {
              (document as any).requestStorageAccessFor = origRSAF;
            }
            isSorting = false;
            startObserving();
          }
        });

        waitForExpand.observe(collapsibleEntry, {
          childList: true,
          subtree: true,
        });

        // タイムアウト: 3秒待っても読み込まれなければ表示中のみでソート
        setTimeout(() => {
          waitForExpand.disconnect();
          if (origRSAF) {
            (document as any).requestStorageAccessFor = origRSAF;
          }
          if (isSorting) {
            sortVisibleOnly(items);
            isSorting = false;
            startObserving();
          }
        }, 3000);

        return;
      }

      // expanderLink が見つからなかった場合は復元
      if (origRSAF) {
        (document as any).requestStorageAccessFor = origRSAF;
      }
    }

    // 既に読み込み済みの場合
    sortWithCollapsed(items, collapsibleEntry);
  } finally {
    if (isSorting) {
      isSorting = false;
      startObserving();
    }
  }
}

function sortVisibleOnly(items: Element): void {
  const entries = getVisibleEntries(items);
  if (entries.length === 0) return;

  const live = entries.filter(isLiveEntry);
  const normal = entries.filter((e) => !isLiveEntry(e));

  if (live.length === 0) return;

  const desired = [...live, ...normal];
  if (entries.every((e, i) => e === desired[i])) return;

  logSort(live);

  const collapsible = items.querySelector(
    "ytd-guide-collapsible-entry-renderer"
  );
  for (const entry of desired) {
    if (collapsible) {
      items.insertBefore(entry, collapsible);
    } else {
      items.appendChild(entry);
    }
  }
}

function sortWithCollapsed(items: Element, collapsibleEntry: Element): void {
  const visible = getVisibleEntries(items);
  const collapsed = getCollapsedEntries(items);

  const expandableItems = collapsibleEntry.querySelector("#expandable-items");

  const liveFromVisible = visible.filter(isLiveEntry);
  const liveFromCollapsed = collapsed.filter(isLiveEntry);
  const normalVisible = visible.filter((e) => !isLiveEntry(e));
  const normalCollapsed = collapsed.filter((e) => !isLiveEntry(e));

  const allLive = [...liveFromVisible, ...liveFromCollapsed];
  if (allLive.length === 0) return;

  // 既にソート済みかチェック
  if (liveFromCollapsed.length === 0) {
    const desired = [...liveFromVisible, ...normalVisible];
    if (visible.every((e, i) => e === desired[i])) return;
  }

  logSort(allLive);

  // 折りたたみからライブを引き上げ、代わりに表示末尾の非ライブを退避
  if (liveFromCollapsed.length > 0 && expandableItems) {
    const toCollapse = normalVisible.splice(
      normalVisible.length - liveFromCollapsed.length,
      liveFromCollapsed.length
    );

    for (const entry of toCollapse) {
      expandableItems.insertBefore(entry, expandableItems.firstChild);
    }
  }

  // 表示エリアを並び替え
  const newOrder = [...allLive, ...normalVisible];
  for (const entry of newOrder) {
    items.insertBefore(entry, collapsibleEntry);
  }
}

function logSort(liveEntries: HTMLElement[]): void {
  console.log(
    LOG_PREFIX,
    "配信中チャンネルを上に移動:",
    liveEntries.map(
      (e) =>
        e.querySelector("yt-formatted-string.title")?.textContent?.trim() ?? "?"
    )
  );
}

function observe(): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const debouncedSort = (): void => {
    if (isSorting) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => expandAndSort(), 500);
  };

  observer = new MutationObserver(() => {
    debouncedSort();
  });

  const waitForGuide = (): void => {
    const guide = document.querySelector(
      "ytd-guide-renderer, tp-yt-app-drawer"
    );
    if (guide) {
      observeTarget = guide;
      startObserving();
      console.log(LOG_PREFIX, "監視開始");
      expandAndSort();
    } else {
      setTimeout(waitForGuide, 1000);
    }
  };

  waitForGuide();

  document.addEventListener("yt-navigate-finish", () => {
    debouncedSort();
  });
}

observe();
