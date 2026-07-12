import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(() => "event-id"),
  captureMessage: vi.fn(() => "message-id"),
}));

vi.mock("@sentry/react", () => ({
  init: sentryMocks.init,
  captureException: sentryMocks.captureException,
  captureMessage: sentryMocks.captureMessage,
  consoleLoggingIntegration: vi.fn(() => ({})),
}));

describe("lazy Sentry reporting", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
  });

  it("reports the first exception exactly once after loading Sentry", async () => {
    const { captureException } = await import("./sentryLazy.jsx");
    const error = new Error("first failure");

    await captureException(error, { source: "test" });

    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureException).toHaveBeenCalledWith(error, {
      source: "test",
    });
  });

  it("initializes global listeners once and preserves rejection errors", async () => {
    const listeners = new Map();
    const addEventListener = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener) => listeners.set(type, listener));
    const { initErrorHandlers } = await import("./sentryLazy.jsx");

    initErrorHandlers();
    initErrorHandlers();

    expect(addEventListener).toHaveBeenCalledTimes(2);
    const rejection = new Error("async failure");
    listeners.get("unhandledrejection")({
      reason: rejection,
      promise: Promise.resolve(),
    });

    await vi.waitFor(() => {
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    });
    expect(sentryMocks.captureException.mock.calls[0][0]).toBe(rejection);
    addEventListener.mockRestore();
  });
});
