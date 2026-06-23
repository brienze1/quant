import { useRef, useState, useEffect, useCallback } from "react";
import { StatusDot } from "./StatusDot";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { useMenu, type HostMenuItem } from "./MenuHost";
import type { DisplayStatus } from "./StatusBadge";

// Session tabs and file tabs share the bar, discriminated by `kind` (App's
// tabs derivation always tags it).
export type Tab =
  | { kind: "session"; id: string; name: string; displayStatus: DisplayStatus }
  | { kind: "file"; id: string; name: string; dirty: boolean; tooltip: string };

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToLeft: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  /** Trailing `+` opens the new-session flow (optional — hidden when absent). */
  onNewSession?: () => void;
  /** Detach a file tab into the dock as its own panel (file tabs only). */
  onDetachFile?: (id: string) => void;
}

// Git-status letter tone for file tabs (M=modified, A=added, D=deleted).
const FILE_TAB_TONE: Record<string, string> = {
  M: "var(--warn)",
  A: "var(--accent)",
  D: "var(--danger)",
};

function ScrollButton({
  direction,
  onClick,
  visible,
}: {
  direction: "left" | "right";
  onClick: () => void;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="shrink-0 flex items-center justify-center"
      style={{
        width: 26,
        alignSelf: "stretch",
        background: "var(--panel)",
        color: "var(--fg-3)",
        border: "none",
        borderRight: direction === "left" ? "1px solid var(--border-2)" : "none",
        borderLeft: direction === "right" ? "1px solid var(--border-2)" : "none",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-3)")}
      title={`Scroll ${direction}`}
    >
      <Icon name={direction === "left" ? "chevronRight" : "chevronRight"} size={13} style={{ transform: direction === "left" ? "scaleX(-1)" : undefined }} />
    </button>
  );
}

/** A single tab cell — session (status dot) or file (git-status letter). */
function TabCell({
  tab,
  active,
  onSelect,
  onClose,
  onDetach,
  onContextMenu,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDetach?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isFile = tab.kind === "file";
  const status = isFile && (tab as Extract<Tab, { kind: "file" }>).dirty ? "M" : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={isFile ? (tab as Extract<Tab, { kind: "file" }>).tooltip : undefined}
      className="shrink-0"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: isFile ? 7 : 8,
        height: 46,
        padding: "0 10px 0 12px",
        cursor: "pointer",
        maxWidth: isFile ? 210 : 190,
        background: active ? "var(--panel)" : hovered ? "var(--hover)" : "transparent",
        color: active ? "var(--fg)" : "var(--fg-3)",
        borderRight: "1px solid var(--border-2)",
      }}
    >
      {active && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -1,
            height: 2,
            background: "var(--accent)",
          }}
        />
      )}

      {isFile ? (
        <Icon name="file" size={12} color={active ? "var(--fg-2)" : "var(--fg-4)"} />
      ) : (
        <StatusDot
          status={(tab as Extract<Tab, { kind: "session" }>).displayStatus}
          size={7}
        />
      )}

      <span
        className="overflow-hidden whitespace-nowrap"
        style={{
          fontSize: isFile ? 11.5 : 12,
          fontWeight: active ? 600 : 500,
          fontFamily: isFile ? "var(--mono)" : "var(--sans)",
          letterSpacing: isFile ? undefined : "-0.01em",
          textOverflow: "ellipsis",
          flex: 1,
          minWidth: 0,
        }}
      >
        {tab.name}
      </span>

      {status && (
        <span
          className="mono shrink-0"
          style={{ fontSize: 10, fontWeight: 700, color: FILE_TAB_TONE[status] || "var(--fg-3)" }}
          title="unsaved changes"
        >
          {status}
        </span>
      )}

      {isFile && onDetach && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onDetach();
          }}
          title="Detach to panel"
          style={{
            display: "flex",
            width: 16,
            height: 16,
            borderRadius: 4,
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            opacity: hovered || active ? 1 : 0,
            color: "var(--fg-3)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-3)")}
        >
          <Icon name="columns" size={11} />
        </span>
      )}

      <span
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="close tab"
        style={{
          display: "flex",
          width: 16,
          height: 16,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          opacity: hovered || active ? 1 : 0,
          color: "var(--fg-3)",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-3)")}
      >
        <Icon name="x" size={11} />
      </span>
    </div>
  );
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onNewSession,
  onDetachFile,
}: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const openMenu = useMenu();

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
    const idx = tabs.findIndex((t) => t.id === tabId);
    const items: HostMenuItem[] = [
      {
        icon: "x",
        label: "close all tabs",
        tone: "danger",
        onClick: () => onCloseAllTabs(),
      },
      {
        icon: "arrowLeft",
        label: "close tabs to the left",
        disabled: idx <= 0,
        onClick: () => onCloseTabsToLeft(tabId),
      },
      {
        icon: "arrowRight",
        label: "close tabs to the right",
        disabled: idx >= tabs.length - 1,
        onClick: () => onCloseTabsToRight(tabId),
      },
    ];
    openMenu(e, items);
  }

  return (
    <div
      className="flex items-stretch shrink-0 min-w-0 overflow-hidden"
      style={{
        height: 46,
        background: "var(--panel)",
        borderBottom: "1px solid var(--border-2)",
      }}
    >
      <ScrollButton direction="left" onClick={() => scroll("left")} visible={canScrollLeft} />
      <div
        ref={scrollRef}
        className="flex items-stretch flex-1 min-w-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        onWheel={(e) => {
          const el = scrollRef.current;
          if (el && e.deltaY !== 0) {
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
      >
        {tabs.map((tab) => (
          <TabCell
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
            onDetach={onDetachFile && tab.kind === "file" ? () => onDetachFile(tab.id) : undefined}
            onContextMenu={(e) => openTabContextMenu(e, tab.id)}
          />
        ))}
      </div>
      <ScrollButton direction="right" onClick={() => scroll("right")} visible={canScrollRight} />
      {onNewSession && (
        <div
          className="shrink-0 flex items-center"
          style={{ padding: "0 6px", borderLeft: "1px solid var(--border-2)" }}
        >
          <IconButton name="plus" label="New session" onClick={onNewSession} />
        </div>
      )}
    </div>
  );
}
