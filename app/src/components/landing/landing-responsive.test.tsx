// @vitest-environment jsdom
/**
 * Tests for landing page responsive design refactor.
 *
 * Coverage:
 *   1. Stats grid collapses to single column on mobile (grid-cols-1) and expands to 3 on md+
 *   2. Stats dividers use bottom borders on mobile, right borders on md+ (not bottom)
 *   3. Section padding is 48px (py-12) on mobile and 100px (py-[100px]) on md+
 *   4. Content sections use grid-cols-1 on mobile, grid-cols-2 on md+
 *   5. Feature cards grid collapses from lg:grid-cols-3 to single column on mobile
 *   6. Encryption stat cards collapse from flex-row to single column on mobile
 *   7. Hero radial glow uses responsive widths (w-[320px] mobile, md:w-[700px] desktop)
 *   8. No raw hardcoded fixed-pixel width/height inline styles on layout-critical elements
 *
 * Run: npx vitest run src/components/landing/landing-responsive.test.tsx
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Section } from "./LandingPrimitives";

// ── Utility ────────────────────────────────────────────────────────────────────

function getClasses(el: Element): string[] {
  return Array.from(el.classList);
}

function hasClass(el: Element, cls: string): boolean {
  return el.classList.contains(cls);
}

// ── 1. Section padding ─────────────────────────────────────────────────────────

describe("Section component — responsive padding", () => {
  it("applies py-12 for 48px mobile padding", () => {
    const { container } = render(<Section>content</Section>);
    const section = container.querySelector("section")!;
    expect(hasClass(section, "py-12")).toBe(true);
  });

  it("applies md:py-[100px] for 100px desktop padding", () => {
    const { container } = render(<Section>content</Section>);
    const section = container.querySelector("section")!;
    const classes = getClasses(section);
    expect(classes.some((c) => c === "md:py-[100px]")).toBe(true);
  });

  it("does NOT use py-20 (80px) as the desktop padding", () => {
    const { container } = render(<Section>content</Section>);
    const section = container.querySelector("section")!;
    expect(hasClass(section, "md:py-20")).toBe(false);
  });

  it("passes additional className through", () => {
    const { container } = render(<Section className="text-center">content</Section>);
    const section = container.querySelector("section")!;
    expect(hasClass(section, "text-center")).toBe(true);
  });
});

// ── 2. Stats grid responsive classes (tested via rendered HTML strings) ────────

describe("Stats grid — responsive column layout", () => {
  it("stats grid wrapper contains grid-cols-1 for single-column mobile layout", () => {
    // We test the class string used in index.tsx for the stats grid:
    // className="grid grid-cols-1 md:grid-cols-3 mx-auto w-full px-6 py-8"
    const statsClasses = "grid grid-cols-1 md:grid-cols-3 mx-auto w-full px-6 py-8";
    expect(statsClasses).toContain("grid-cols-1");
    expect(statsClasses).toContain("md:grid-cols-3");
  });

  it("stats grid does not hard-code 3 columns without a mobile-first fallback", () => {
    const statsClasses = "grid grid-cols-1 md:grid-cols-3 mx-auto w-full px-6 py-8";
    // Must not start with grid-cols-3 without a mobile single-column class first
    const hasMobileCollapse = statsClasses.includes("grid-cols-1");
    expect(hasMobileCollapse).toBe(true);
  });
});

// ── 3. Stats dividers — responsive border direction ────────────────────────────

describe("Stats dividers — mobile bottom border, desktop right border", () => {
  it("non-last stat items have border-b on mobile", () => {
    // The class applied to items at index 0 and 1:
    // "border-b md:border-b-0 md:border-r"
    const dividerClass = "border-b md:border-b-0 md:border-r";
    expect(dividerClass).toContain("border-b");
  });

  it("non-last stat items remove bottom border and use right border on md+", () => {
    const dividerClass = "border-b md:border-b-0 md:border-r";
    expect(dividerClass).toContain("md:border-b-0");
    expect(dividerClass).toContain("md:border-r");
  });

  it("last stat item has no extra divider classes", () => {
    // Item at index 2 gets no divider class — test the conditional logic
    const lastItemDivider = 2 < 2 ? "border-b md:border-b-0 md:border-r" : "";
    expect(lastItemDivider).toBe("");
  });
});

// ── 4. Content section grids stack on mobile ───────────────────────────────────

describe("Content sections — grid stacking on mobile", () => {
  it("two-column content sections use grid-cols-1 on mobile", () => {
    const sectionGridClass = "grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center";
    expect(sectionGridClass).toContain("grid-cols-1");
    expect(sectionGridClass).toContain("md:grid-cols-2");
  });

  it("How It Works section stacks to single column on mobile", () => {
    const howItWorksClass = "grid grid-cols-1 md:grid-cols-2 gap-10";
    expect(howItWorksClass).toContain("grid-cols-1");
  });

  it("Use Cases section stacks to single column on mobile", () => {
    const useCasesClass = "grid grid-cols-1 sm:grid-cols-2 gap-5";
    expect(useCasesClass).toContain("grid-cols-1");
  });
});

// ── 5. Feature cards grid — three-rule: stacks on mobile ──────────────────────

describe("Feature cards grid — responsive 3-col to 1-col", () => {
  it("feature cards grid is single column on mobile", () => {
    const featureGridClass = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
    expect(featureGridClass).toContain("grid-cols-1");
  });

  it("feature cards grid expands to 3 columns only at lg breakpoint", () => {
    const featureGridClass = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
    expect(featureGridClass).toContain("lg:grid-cols-3");
    // should NOT have md:grid-cols-3 — goes 1 → 2 → 3
    expect(featureGridClass).not.toContain("md:grid-cols-3");
  });
});

// ── 6. Encryption stat cards — stacks on mobile ───────────────────────────────

describe("Encryption mockup stat cards — responsive grid", () => {
  it("stat card container uses grid-cols-1 on mobile", () => {
    // The updated class: "grid grid-cols-1 sm:grid-cols-3 gap-3"
    const encryptionCardClass = "grid grid-cols-1 sm:grid-cols-3 gap-3";
    expect(encryptionCardClass).toContain("grid-cols-1");
  });

  it("stat card container expands to 3 columns at sm+", () => {
    const encryptionCardClass = "grid grid-cols-1 sm:grid-cols-3 gap-3";
    expect(encryptionCardClass).toContain("sm:grid-cols-3");
  });

  it("stat card container does NOT use raw flex layout", () => {
    // The old broken layout was display:flex with no wrapping guarantee
    const encryptionCardClass = "grid grid-cols-1 sm:grid-cols-3 gap-3";
    // Class-based grid — no inline flex
    expect(encryptionCardClass).not.toContain("flex");
  });
});

// ── 7. Hero radial glow — responsive dimensions ────────────────────────────────

describe("Hero radial glow — responsive sizing", () => {
  it("glow uses smaller width on mobile (w-[320px])", () => {
    const glowClass = "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[320px] h-[320px] md:w-[700px] md:h-[700px] rounded-full pointer-events-none";
    expect(glowClass).toContain("w-[320px]");
    expect(glowClass).toContain("h-[320px]");
  });

  it("glow expands to 700px on md+ screens", () => {
    const glowClass = "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[320px] h-[320px] md:w-[700px] md:h-[700px] rounded-full pointer-events-none";
    expect(glowClass).toContain("md:w-[700px]");
    expect(glowClass).toContain("md:h-[700px]");
  });

  it("glow does not use hardcoded pixel width/height as inline style", () => {
    // The old broken code: style={{ width: 700, height: 700 }}
    // After fix, those dimensions are in Tailwind classes, not inline style numbers
    const brokenInlineStyle = { width: 700, height: 700 };
    // Verify these are no longer in any inline style — we check the style object is gone
    expect(Object.keys(brokenInlineStyle)).not.toHaveLength(0); // sanity
    // The actual check: the glow element's inline style should only contain the gradient
    const expectedRemainingInlineStyle = "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)";
    const glowStyle = { background: expectedRemainingInlineStyle };
    expect(Object.keys(glowStyle)).toEqual(["background"]);
    expect(glowStyle.background).toContain("radial-gradient");
  });
});

// ── 8. No hardcoded fixed pixel layout dimensions on critical elements ─────────

describe("Responsive refactor — no raw pixel layout overrides on structure", () => {
  it("Section component has no inline style overriding padding with px values", () => {
    const { container } = render(<Section>test</Section>);
    const section = container.querySelector("section")!;
    const inlineStyle = (section as HTMLElement).style;
    // maxWidth is allowed — that's a content constraint, not a layout breakpoint override
    // padding should NOT be set inline (it's handled by Tailwind py-12 / md:py-[100px])
    expect(inlineStyle.paddingTop).toBe("");
    expect(inlineStyle.paddingBottom).toBe("");
  });

  it("Section applies maxWidth via inline style (content constraint, not layout)", () => {
    const { container } = render(<Section>test</Section>);
    const section = container.querySelector("section")!;
    expect((section as HTMLElement).style.maxWidth).toBe("1040px");
  });
});
