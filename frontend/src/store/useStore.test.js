import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/api", () => ({
  getRandomLocation: vi.fn(),
  streamLocationDescription: vi.fn(),
  setExplorationPreference: vi.fn(),
  deleteExplorationPreference: vi.fn(),
  lookupLocation: vi.fn(),
}));

vi.mock("../i18n", () => ({
  default: {
    language: "zh",
    resolvedLanguage: "zh",
    t: (key) => key,
  },
}));

import useStore from "./useStore";

describe("toast lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ toastMessage: "", showToast: false });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("does not let an older timer hide a newer toast", () => {
    useStore.getState().showToastMessage("first");
    vi.advanceTimersByTime(2000);
    useStore.getState().showToastMessage("second");

    vi.advanceTimersByTime(1100);
    expect(useStore.getState().showToast).toBe(true);
    expect(useStore.getState().toastMessage).toBe("second");

    vi.advanceTimersByTime(1900);
    expect(useStore.getState().showToast).toBe(false);
  });
});
