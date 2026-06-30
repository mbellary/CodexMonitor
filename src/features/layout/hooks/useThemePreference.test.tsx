// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThemePreference } from "../../../types";
import { useThemePreference } from "./useThemePreference";

describe("useThemePreference", () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
  });

  it("applies explicit themes to the document root", () => {
    renderHook(() => useThemePreference("dark"));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("removes the explicit theme when returning to system", () => {
    const { rerender } = renderHook(
      ({ theme }: { theme: ThemePreference }) => useThemePreference(theme),
      { initialProps: { theme: "dark" as ThemePreference } },
    );

    expect(document.documentElement.dataset.theme).toBe("dark");

    rerender({ theme: "system" });

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
