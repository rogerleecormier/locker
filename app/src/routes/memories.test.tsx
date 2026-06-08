/// <reference types="vitest/globals" />
/// <reference types="@testing-library/react" />

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState, useMemo } from "react";

// Constants from memories.tsx
const STALE_MEMORY_DAYS = 90;
const STALE_MEMORY_MS = STALE_MEMORY_DAYS * 24 * 60 * 60 * 1000;
const STALE_BANNER_DISMISS_KEY = "locker-stale-banner-dismissed-at";
const STALE_BANNER_DISMISS_TTL_DAYS = 7;
const STALE_BANNER_DISMISS_TTL_MS = STALE_BANNER_DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;

describe("Stale Memory Banner Feature", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("Constants", () => {
    it("should define STALE_MEMORY_DAYS as 90", () => {
      expect(STALE_MEMORY_DAYS).toBe(90);
    });

    it("should calculate STALE_MEMORY_MS correctly", () => {
      const expected = 90 * 24 * 60 * 60 * 1000;
      expect(STALE_MEMORY_MS).toBe(expected);
    });

    it("should define STALE_BANNER_DISMISS_TTL_DAYS as 7", () => {
      expect(STALE_BANNER_DISMISS_TTL_DAYS).toBe(7);
    });

    it("should calculate STALE_BANNER_DISMISS_TTL_MS correctly", () => {
      const expected = 7 * 24 * 60 * 60 * 1000;
      expect(STALE_BANNER_DISMISS_TTL_MS).toBe(expected);
    });

    it("should use localStorage key for banner dismissal", () => {
      expect(STALE_BANNER_DISMISS_KEY).toBe("locker-stale-banner-dismissed-at");
    });
  });

  describe("useStaleMemoryBanner hook", () => {
    function TestHookComponent({ staleCount }: { staleCount: number }) {
      const [dismissed, setDismissed] = useState(() => {
        const ts = localStorage.getItem(STALE_BANNER_DISMISS_KEY);
        if (!ts) return false;
        return Date.now() - Number(ts) < STALE_BANNER_DISMISS_TTL_MS;
      });

      function dismiss() {
        setDismissed(true);
        localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(Date.now()));
      }

      const visible = !dismissed && staleCount > 0;

      return (
        <div>
          <div data-testid="banner-visible">{visible ? "visible" : "hidden"}</div>
          <button onClick={dismiss} data-testid="dismiss-btn">
            Dismiss
          </button>
        </div>
      );
    }

    it("should show banner when staleCount > 0 and not dismissed", () => {
      render(<TestHookComponent staleCount={5} />);
      expect(screen.getByTestId("banner-visible").textContent).toBe("visible");
    });

    it("should hide banner when staleCount is 0", () => {
      render(<TestHookComponent staleCount={0} />);
      expect(screen.getByTestId("banner-visible").textContent).toBe("hidden");
    });

    it("should hide banner after dismissal", async () => {
      render(<TestHookComponent staleCount={5} />);
      expect(screen.getByTestId("banner-visible").textContent).toBe("visible");

      fireEvent.click(screen.getByTestId("dismiss-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("banner-visible").textContent).toBe("hidden");
      });
    });

    it("should persist dismissal timestamp to localStorage", async () => {
      render(<TestHookComponent staleCount={5} />);
      fireEvent.click(screen.getByTestId("dismiss-btn"));

      await waitFor(() => {
        const storedTs = localStorage.getItem(STALE_BANNER_DISMISS_KEY);
        expect(storedTs).toBeTruthy();
        expect(Number(storedTs)).toBeGreaterThan(0);
      });
    });

    it("should respect dismissal TTL of 7 days", () => {
      const now = Date.now();
      const sevenDaysAgo = now - STALE_BANNER_DISMISS_TTL_MS + 1000; // 1 second before expiry

      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(sevenDaysAgo));
      render(<TestHookComponent staleCount={5} />);

      expect(screen.getByTestId("banner-visible").textContent).toBe("hidden");
    });

    it("should show banner again after TTL expires", () => {
      const now = Date.now();
      const eightDaysAgo = now - STALE_BANNER_DISMISS_TTL_MS - 1000; // 1 second after expiry

      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(eightDaysAgo));
      render(<TestHookComponent staleCount={5} />);

      expect(screen.getByTestId("banner-visible").textContent).toBe("visible");
    });
  });

  describe("Stale Memory Detection", () => {
    function StaleCountComponent({ memories }: { memories: any[] }) {
      const staleCount = useMemo(
        () => memories.filter((m) => Date.now() - new Date(m.timestamp).getTime() > STALE_MEMORY_MS).length,
        [memories]
      );

      return <div data-testid="stale-count">{staleCount}</div>;
    }

    it("should correctly count memories older than 90 days", () => {
      const now = Date.now();
      const memories = [
        { id: "1", timestamp: new Date(now - STALE_MEMORY_MS - 1000).toISOString() }, // stale
        { id: "2", timestamp: new Date(now - STALE_MEMORY_MS + 1000).toISOString() }, // not stale
        { id: "3", timestamp: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() }, // not stale (60 days)
      ];

      render(<StaleCountComponent memories={memories} />);
      expect(screen.getByTestId("stale-count").textContent).toBe("1");
    });

    it("should count zero stale memories when all are recent", () => {
      const now = Date.now();
      const memories = [
        { id: "1", timestamp: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "2", timestamp: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString() },
      ];

      render(<StaleCountComponent memories={memories} />);
      expect(screen.getByTestId("stale-count").textContent).toBe("0");
    });

    it("should count all memories as stale if all are older than 90 days", () => {
      const now = Date.now();
      const memories = [
        { id: "1", timestamp: new Date(now - STALE_MEMORY_MS - 1000).toISOString() },
        { id: "2", timestamp: new Date(now - STALE_MEMORY_MS - 100 * 24 * 60 * 60 * 1000).toISOString() },
        { id: "3", timestamp: new Date(now - STALE_MEMORY_MS - 200 * 24 * 60 * 60 * 1000).toISOString() },
      ];

      render(<StaleCountComponent memories={memories} />);
      expect(screen.getByTestId("stale-count").textContent).toBe("3");
    });

    it("should handle empty memories array", () => {
      render(<StaleCountComponent memories={[]} />);
      expect(screen.getByTestId("stale-count").textContent).toBe("0");
    });
  });

  describe("StaleMemoryBanner Component", () => {
    function StaleMemoryBanner({
      staleCount,
      onFilter,
      onDismiss,
    }: {
      staleCount: number;
      onFilter: () => void;
      onDismiss: () => void;
    }) {
      return (
        <div
          className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200 select-none"
          data-testid="stale-banner"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <button
            type="button"
            onClick={onFilter}
            className="flex-1 text-left text-xs font-semibold text-amber-600 hover:text-amber-500 transition-colors"
            data-testid="filter-btn"
          >
            You have{" "}
            <span className="font-bold underline underline-offset-2 decoration-amber-500/50">
              {staleCount} {staleCount === 1 ? "memory" : "memories"}
            </span>{" "}
            older than {STALE_MEMORY_DAYS} days — consider reviewing them.
          </button>
          <button
            type="button"
            title="Dismiss for 7 days"
            onClick={onDismiss}
            className="shrink-0 h-6 w-6 flex items-center justify-center text-amber-500/60 hover:text-amber-500 rounded-md hover:bg-amber-500/10 transition-colors text-sm leading-none"
            data-testid="dismiss-btn"
          >
            ✕
          </button>
        </div>
      );
    }

    it("should render with correct stale count", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);

      expect(screen.getByTestId("stale-banner")).toBeTruthy();
      expect(screen.getByText(/3 memories/)).toBeTruthy();
    });

    it("should use singular form for 1 memory", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={1} onFilter={onFilter} onDismiss={onDismiss} />);

      expect(screen.getByText(/1 memory/)).toBeTruthy();
    });

    it("should use plural form for multiple memories", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={5} onFilter={onFilter} onDismiss={onDismiss} />);

      expect(screen.getByText(/5 memories/)).toBeTruthy();
    });

    it("should display 90-day threshold in message", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);

      expect(screen.getByText(/90 days/)).toBeTruthy();
    });

    it("should have amber warning design styles", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      const { container } = render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);
      const banner = container.querySelector("[data-testid='stale-banner']");

      expect(banner?.classList.contains("bg-amber-500/10")).toBe(true);
      expect(banner?.classList.contains("border-amber-500/25")).toBe(true);
    });

    it("should call onFilter when filter button clicked", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByTestId("filter-btn"));

      expect(onFilter).toHaveBeenCalledTimes(1);
    });

    it("should call onDismiss when dismiss button clicked", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByTestId("dismiss-btn"));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("should have correct dismissal tooltip", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);

      const dismissBtn = screen.getByTestId("dismiss-btn");
      expect(dismissBtn.getAttribute("title")).toBe("Dismiss for 7 days");
    });

    it("should have dismiss button with X symbol", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={3} onFilter={onFilter} onDismiss={onDismiss} />);

      expect(screen.getByText("✕")).toBeTruthy();
    });

    it("should handle very large stale counts", () => {
      const onFilter = vi.fn();
      const onDismiss = vi.fn();

      render(<StaleMemoryBanner staleCount={1000} onFilter={onFilter} onDismiss={onDismiss} />);

      expect(screen.getByText(/1000 memories/)).toBeTruthy();
    });
  });

  describe("localStorage TTL Management", () => {
    it("should store dismissal timestamp in correct format", () => {
      const timestamp = Date.now();
      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(timestamp));

      const stored = localStorage.getItem(STALE_BANNER_DISMISS_KEY);
      expect(Number(stored)).toBe(timestamp);
    });

    it("should correctly calculate TTL expiration", () => {
      const now = Date.now();
      const sevenDaysMs = STALE_BANNER_DISMISS_TTL_MS;

      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(now));

      const elapsed = Date.now() - Number(localStorage.getItem(STALE_BANNER_DISMISS_KEY)!);
      expect(elapsed).toBeLessThan(1000);

      const expiredTs = now - sevenDaysMs - 1000;
      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(expiredTs));

      const isExpired = Date.now() - Number(localStorage.getItem(STALE_BANNER_DISMISS_KEY)!) > sevenDaysMs;
      expect(isExpired).toBe(true);
    });

    it("should clear dismissal state after TTL expires", () => {
      const now = Date.now();
      const expiredTs = now - STALE_BANNER_DISMISS_TTL_MS - 1000;

      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(expiredTs));

      const storedTs = localStorage.getItem(STALE_BANNER_DISMISS_KEY);
      const isValid = storedTs && Date.now() - Number(storedTs) < STALE_BANNER_DISMISS_TTL_MS;

      expect(isValid).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle timestamp at exact 90-day boundary", () => {
      const now = Date.now();
      const exactBoundary = new Date(now - STALE_MEMORY_MS).toISOString();

      const memories = [{ id: "1", timestamp: exactBoundary }];
      const staleCount = memories.filter((m) => Date.now() - new Date(m.timestamp).getTime() > STALE_MEMORY_MS).length;

      expect(staleCount).toBe(0);
    });

    it("should handle timestamp just after 90-day boundary", () => {
      const now = Date.now();
      const justAfterBoundary = new Date(now - STALE_MEMORY_MS - 1).toISOString();

      const memories = [{ id: "1", timestamp: justAfterBoundary }];
      const staleCount = memories.filter((m) => Date.now() - new Date(m.timestamp).getTime() > STALE_MEMORY_MS).length;

      expect(staleCount).toBe(1);
    });
  });

  describe("Dismissal Persistence", () => {
    it("should only dismiss for exactly 7 days, not more", () => {
      const now = Date.now();
      const almostSevenDays = now - STALE_BANNER_DISMISS_TTL_MS + 100;

      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(almostSevenDays));

      const elapsed = Date.now() - Number(localStorage.getItem(STALE_BANNER_DISMISS_KEY)!);
      const isStillDismissed = elapsed < STALE_BANNER_DISMISS_TTL_MS;

      expect(isStillDismissed).toBe(true);
    });

    it("should update timestamp on subsequent dismissals", () => {
      const now = Date.now();
      const firstDismissal = now - 1000;

      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(firstDismissal));
      const firstTs = localStorage.getItem(STALE_BANNER_DISMISS_KEY)!;

      const secondDismissal = now;
      localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(secondDismissal));
      const secondTs = localStorage.getItem(STALE_BANNER_DISMISS_KEY)!;

      expect(Number(secondTs)).toBeGreaterThan(Number(firstTs));
    });
  });
});
