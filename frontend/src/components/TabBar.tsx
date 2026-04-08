import { useRef, useState, useEffect, useCallback } from "react";
import { StatusDot } from "./StatusDot";
import { ContextMenu } from "./ContextMenu";
import type { DisplayStatus } from "./StatusBadge";
import type { MenuItem } from "./ContextMenu";

interface Tab {
  id: string;
  name: string;
  displayStatus: DisplayStatus;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToLeft: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
}

function ScrollButton({
  direction,
  onClick,
  visible,
}: {
  direction: "left" | "right";
  onClick: () => void;
  visible: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="shrink-0 flex items-center justify-center"
      style={{
        width: 24,
        backgroundColor: hovered ? "var(--q-bg-hover)" : "var(--q-bg)",
        color: hovered ? "var(--q-fg)" : "var(--q-fg-secondary)",
        borderRight: direction === "left" ? "1px solid var(--q-border)" : "none",
        borderLeft: direction === "right" ? "1px solid var(--q-border)" : "none",
        cursor: "pointer",
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      title={`Scroll ${direction}`}
    >
      {direction === "left" ? "<" : ">"}
    </button>
  );
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onCloseAllTabs, onCloseTabsToLeft, onCloseTabsToRight }: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollState();

    el.addEventListener("scroll", updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, [updateScrollState, tabs.length]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = 200;
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  if (tabs.length === 0) return null;

  function openTabContextMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }

  function getContextMenuItems(tabId: string): MenuItem[] {
    const idx = tabs.findIndex((t) => t.id === tabId);
    return [
      {
        type: "item",
        icon: "×",
        iconColor: "var(--q-error)",
        label: "close all tabs",
        onClick: () => onCloseAllTabs(),
      },
      {
        type: "item",
        icon: "←",
        iconColor: "var(--q-fg-secondary)",
        label: "close tabs to the left",
        onClick: () => onCloseTabsToLeft(tabId),
        ...(idx === 0 ? { labelColor: "var(--q-fg-muted)" } : {}),
      },
      {
        type: "item",
        icon: "→",
        iconColor: "var(--q-fg-secondary)",
        label: "close tabs to the right",
        onClick: () => onCloseTabsToRight(tabId),
        ...(idx === tabs.length - 1 ? { labelColor: "var(--q-fg-muted)" } : {}),
      },
    ];
  }

  return (
    <>
    <div
      className="flex items-center shrink-0 min-w-0 overflow-hidden"
      style={{
        backgroundColor: "var(--q-bg)",
        borderBottom: "1px solid var(--q-border)",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <ScrollButton
        direction="left"
        onClick={() => scroll("left")}
        visible={canScrollLeft}
      />
      <div
        ref={scrollRef}
        className="flex items-center flex-1 min-w-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && e.deltaY !== 0) {
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className="flex items-center gap-1.5 px-3 py-2 shrink-0 cursor-pointer"
              style={{
                backgroundColor: isActive ? "var(--q-bg-hover)" : "transparent",
                borderRight: "1px solid var(--q-border)",
                maxWidth: 200,
              }}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => openTabContextMenu(e, tab.id)}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <StatusDot status={tab.displayStatus} />
              <span
                className="text-xs overflow-hidden whitespace-nowrap flex-1"
                style={{
                  color: isActive ? "var(--q-fg)" : "var(--q-fg-secondary)",
                  textOverflow: "ellipsis",
                }}
              >
                {tab.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="shrink-0 ml-1 text-[10px] transition-colors"
                style={{ color: "var(--q-fg-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
                title="close tab"
              >
                [x]
              </button>
            </div>
          );
        })}
      </div>
      <ScrollButton
        direction="right"
        onClick={() => scroll("right")}
        visible={canScrollRight}
      />
    </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.tabId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
