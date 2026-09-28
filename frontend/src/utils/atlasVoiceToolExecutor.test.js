import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useStore from "../store/useStore";
import {
  executeAtlasVoiceTool,
  handleAtlasVoiceFunctionCall,
  normalizeLegacyToolCall,
  parseToolArguments,
} from "./atlasVoiceToolExecutor";

const apiMocks = vi.hoisted(() => ({
  deleteExplorationPreference: vi.fn(),
  getRandomLocation: vi.fn(),
  lookupLocation: vi.fn(),
  searchLocation: vi.fn(),
  setExplorationPreference: vi.fn(),
}));

vi.mock("../services/api", () => apiMocks);

const CROMWELL = {
  formatted_address: "Cromwell, New Zealand",
  latitude: -45.0384,
  longitude: 169.2001,
  pano_id: "pano-cromwell",
};

function makeDeps() {
  return {
    language: "en",
    noLocationMessage: "No location is loaded yet.",
    sendLatestSceneContext: vi.fn().mockResolvedValue(true),
  };
}

describe("atlas voice tool arguments", () => {
  it("parses JSON arguments and falls back to an empty object", () => {
    expect(parseToolArguments('{"mode":"random"}')).toEqual({ mode: "random" });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
    expect(parseToolArguments("{not json")).toEqual({});
  });

  it("maps legacy tool names onto navigate modes", () => {
    expect(normalizeLegacyToolCall("explore_random", undefined)).toEqual({
      name: "navigate",
      args: { mode: "random", query: undefined },
    });
    expect(
      normalizeLegacyToolCall("explore_interest", { interest: "harbors" }),
    ).toEqual({
      name: "navigate",
      args: { interest: "harbors", mode: "theme", query: "harbors" },
    });
    expect(
      normalizeLegacyToolCall("go_to_place", { lat: "35.6", lng: 139.7 }).args
        .mode,
    ).toBe("coordinates");
    expect(
      normalizeLegacyToolCall("go_to_place", { query: "Tokyo Tower" }).args
        .mode,
    ).toBe("place");
    expect(normalizeLegacyToolCall("wander_nearby", {}).args.mode).toBe(
      "nearby",
    );
    const args = { mode: "theme" };
    expect(normalizeLegacyToolCall("navigate", args)).toEqual({
      name: "navigate",
      args,
    });
  });
});

describe("executeAtlasVoiceTool", () => {
  let initialState;

  beforeEach(() => {
    initialState = useStore.getState();
    const storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });
    useStore.setState({
      location: CROMWELL,
      currentLocationRef: CROMWELL,
      description: "A road outside town.",
      heading: 10,
      streetViewView: null,
    });
  });

  afterEach(() => {
    useStore.setState(initialState, true);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("summarizes the current place, or reports that none is loaded", async () => {
    const deps = makeDeps();
    await expect(
      executeAtlasVoiceTool("read_current_place", {}, deps),
    ).resolves.toEqual({
      success: true,
      location: "Cromwell, New Zealand (-45.03840, 169.20010)",
      heading: 10,
      description: "A road outside town.",
    });

    useStore.setState({ location: null, currentLocationRef: null });
    await expect(
      executeAtlasVoiceTool("read_current_place", {}, deps),
    ).resolves.toEqual({ success: false, message: deps.noLocationMessage });
  });

  it("switches to random exploration and loads a fresh location", async () => {
    const loadRandomLocation = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ loadRandomLocation, explorationMode: "custom" });
    localStorage.setItem("exploration_interest", "harbors");
    const deps = makeDeps();

    const result = await executeAtlasVoiceTool(
      "navigate",
      { mode: "random" },
      deps,
    );

    expect(apiMocks.deleteExplorationPreference).toHaveBeenCalledWith("en");
    expect(loadRandomLocation).toHaveBeenCalledWith(true, {
      preserveLocation: true,
    });
    expect(localStorage.getItem("exploration_mode")).toBe("random");
    expect(localStorage.getItem("exploration_interest")).toBeNull();
    expect(useStore.getState().explorationMode).toBe("random");
    expect(deps.sendLatestSceneContext).toHaveBeenCalledWith({
      allowAuto: true,
    });
    expect(result).toMatchObject({
      success: true,
      action: "loaded_random_location",
    });
  });

  it("rejects an empty theme and surfaces preference failures as terminal", async () => {
    const deps = makeDeps();
    await expect(
      executeAtlasVoiceTool("navigate", { mode: "theme", query: "  " }, deps),
    ).resolves.toEqual({
      success: false,
      error: "Missing exploration theme",
      terminal: true,
      retry_allowed: false,
    });

    apiMocks.setExplorationPreference.mockResolvedValue({
      success: false,
      error: "quota",
    });
    await expect(
      executeAtlasVoiceTool(
        "navigate",
        { mode: "theme", query: "ports" },
        deps,
      ),
    ).resolves.toEqual({
      success: false,
      error: "quota",
      terminal: true,
      retry_allowed: false,
    });
    expect(deps.sendLatestSceneContext).not.toHaveBeenCalled();
  });

  it("stores a theme preference before loading a themed location", async () => {
    const loadRandomLocation = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ loadRandomLocation });
    apiMocks.setExplorationPreference.mockResolvedValue({ success: true });

    const result = await executeAtlasVoiceTool(
      "explore_interest",
      { interest: " lighthouses " },
      makeDeps(),
    );

    expect(apiMocks.setExplorationPreference).toHaveBeenCalledWith(
      "lighthouses",
      "en",
    );
    expect(localStorage.getItem("exploration_interest")).toBe("lighthouses");
    expect(useStore.getState().explorationInterest).toBe("lighthouses");
    expect(result).toMatchObject({
      success: true,
      action: "loaded_interest_location",
      interest: "lighthouses",
    });
  });

  it("validates coordinates and fails when no panorama is found", async () => {
    const loadLocationFromURL = vi.fn(async () => {
      useStore.setState({ location: { latitude: 1, longitude: 2 } });
    });
    useStore.setState({ loadLocationFromURL });
    const deps = makeDeps();

    await expect(
      executeAtlasVoiceTool(
        "navigate",
        { mode: "coordinates", lat: 91, lng: 0 },
        deps,
      ),
    ).resolves.toMatchObject({
      success: false,
      error: "Coordinates mode requires a valid latitude and longitude.",
      terminal: true,
    });
    expect(loadLocationFromURL).not.toHaveBeenCalled();

    await expect(
      executeAtlasVoiceTool(
        "navigate",
        { mode: "coordinates", lat: 1, lng: 2 },
        deps,
      ),
    ).resolves.toMatchObject({
      success: false,
      error: "Could not find Street View near those coordinates",
    });
    expect(loadLocationFromURL).toHaveBeenCalledWith(1, 2, {
      preserveLocation: true,
    });
  });

  it("keeps the matched place on a failed search and applies a successful one", async () => {
    const deps = makeDeps();
    apiMocks.searchLocation.mockResolvedValueOnce({
      success: false,
      data: null,
      place: { name: "Somewhere" },
      error: "no street view",
    });
    await expect(
      executeAtlasVoiceTool("navigate", { mode: "place", query: "X" }, deps),
    ).resolves.toEqual({
      success: false,
      error: "no street view",
      place: { name: "Somewhere" },
      terminal: true,
      retry_allowed: false,
    });

    apiMocks.searchLocation.mockResolvedValueOnce({
      success: true,
      data: {
        formatted_address: "Tokyo Tower",
        latitude: "35.6586",
        longitude: "139.7454",
        pano_id: "pano-tokyo",
      },
      place: { name: "Tokyo Tower" },
    });
    const result = await executeAtlasVoiceTool(
      "navigate",
      { mode: "place", query: " Tokyo Tower " },
      deps,
    );

    expect(apiMocks.searchLocation).toHaveBeenLastCalledWith(
      "Tokyo Tower",
      "en",
    );
    const { location, currentLocationRef, description } = useStore.getState();
    expect(location).toMatchObject({ latitude: 35.6586, longitude: 139.7454 });
    expect(currentLocationRef).toBe(location);
    expect(description).toBeNull();
    expect(result).toMatchObject({
      success: true,
      action: "loaded_place_search",
      query: "Tokyo Tower",
      matched_place: { name: "Tokyo Tower" },
    });
  });

  it("walks nearby with widening retries until a panorama is found", async () => {
    const calls = [];
    const loadLocationFromURL = vi.fn(async (lat, lng) => {
      calls.push([lat, lng]);
      useStore.setState({
        location:
          calls.length < 3
            ? { latitude: lat, longitude: lng }
            : { latitude: lat, longitude: lng, pano_id: "pano-found" },
      });
    });
    useStore.setState({ loadLocationFromURL });

    const result = await executeAtlasVoiceTool(
      "navigate",
      { mode: "nearby", direction: "north", distance_meters: 100 },
      makeDeps(),
    );

    expect(loadLocationFromURL).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      success: true,
      action: "wandered_nearby",
      direction: "north",
      distance_meters: 180,
    });
  });

  it("reports a terminal failure after all nearby attempts miss", async () => {
    useStore.setState({
      loadLocationFromURL: vi.fn(async () => {
        useStore.setState({ location: { latitude: 0, longitude: 0 } });
      }),
    });

    await expect(
      executeAtlasVoiceTool("navigate", { mode: "nearby" }, makeDeps()),
    ).resolves.toEqual({
      success: false,
      error: "Could not find nearby Street View after a few tries",
      original_location: "Cromwell, New Zealand (-45.03840, 169.20010)",
      terminal: true,
      retry_allowed: false,
    });
  });

  it("keeps the current place and the page when every real nearby lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.lookupLocation.mockResolvedValue({
      success: false,
      error: "no street view",
    });

    const result = await executeAtlasVoiceTool(
      "navigate",
      { mode: "nearby" },
      makeDeps(),
    );

    expect(apiMocks.lookupLocation).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ success: false, terminal: true });
    expect(useStore.getState()).toMatchObject({
      location: CROMWELL,
      locationError: null,
      isLoadingLocation: false,
    });
  });

  it("reports a failed random voice navigation without an error page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.deleteExplorationPreference.mockResolvedValue({ success: true });
    apiMocks.getRandomLocation.mockResolvedValue({
      success: false,
      error: "upstream down",
    });
    useStore.setState({ isExplorationInitialized: true, lastRefreshTime: 0 });

    const result = await executeAtlasVoiceTool(
      "navigate",
      { mode: "random" },
      makeDeps(),
    );

    expect(result).toMatchObject({ success: false, error: "upstream down" });
    expect(useStore.getState().location).toBe(CROMWELL);
    expect(useStore.getState().locationError).toBeNull();
  });

  it("does not let an in-flight random load overwrite a voice place search", async () => {
    let finishRandom;
    apiMocks.getRandomLocation.mockReturnValue(
      new Promise((resolve) => {
        finishRandom = resolve;
      }),
    );
    apiMocks.searchLocation.mockResolvedValue({
      success: true,
      data: { latitude: 35.6586, longitude: 139.7454, pano_id: "pano-tokyo" },
      place: null,
    });
    useStore.setState({ isExplorationInitialized: true, lastRefreshTime: 0 });

    const randomLoad = useStore.getState().loadRandomLocation(true);
    await executeAtlasVoiceTool(
      "navigate",
      { mode: "place", query: "Tokyo Tower" },
      makeDeps(),
    );
    finishRandom({
      success: true,
      data: { latitude: 1, longitude: 2, pano_id: "pano-random" },
    });
    await expect(randomLoad).resolves.toMatchObject({ superseded: true });

    expect(useStore.getState().location.pano_id).toBe("pano-tokyo");
    expect(useStore.getState().isLoadingLocation).toBe(false);
  });

  it("turns the camera and keeps an active Street View pose in sync", async () => {
    const setHeading = vi.fn((value) => useStore.setState({ heading: value }));
    const setStreetViewView = vi.fn();
    useStore.setState({
      setHeading,
      setStreetViewView,
      streetViewView: { panoId: "pano-cromwell", heading: 10, pitch: 0 },
    });

    await expect(
      executeAtlasVoiceTool(
        "look_direction",
        { direction: "right" },
        makeDeps(),
      ),
    ).resolves.toEqual({
      success: true,
      action: "updated_heading",
      heading: 100,
    });
    expect(setHeading).toHaveBeenCalledWith(100);
    expect(setStreetViewView).toHaveBeenCalledWith({
      panoId: "pano-cromwell",
      heading: 100,
      pitch: 0,
      source: "programmatic",
    });

    await expect(
      executeAtlasVoiceTool("look_direction", { heading: -30 }, makeDeps()),
    ).resolves.toMatchObject({ heading: 330 });

    await expect(
      executeAtlasVoiceTool(
        "look_direction",
        { direction: "sideways" },
        makeDeps(),
      ),
    ).resolves.toMatchObject({ success: false });
  });

  it("rejects unknown navigation modes and tools", async () => {
    await expect(
      executeAtlasVoiceTool("navigate", { mode: "teleport" }, makeDeps()),
    ).resolves.toEqual({
      success: false,
      error: "Unknown navigation mode",
      terminal: true,
      retry_allowed: false,
    });
    await expect(executeAtlasVoiceTool("fly", {}, makeDeps())).resolves.toEqual(
      { success: false, error: "Unknown tool: fly" },
    );
  });
});

describe("handleAtlasVoiceFunctionCall", () => {
  function makeCallDeps(executeTool) {
    return {
      handledCallIdsRef: { current: new Set() },
      navigationAttemptedRef: { current: false },
      executeTool: vi.fn(executeTool),
      sendEvent: vi.fn(() => true),
      sendLatestSceneContext: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn(),
      startResponseWatchdog: vi.fn(),
    };
  }

  function sentOutput(deps) {
    const event = deps.sendEvent.mock.calls
      .map(([sent]) => sent)
      .find((sent) => sent.type === "conversation.item.create");
    return JSON.parse(event.item.output);
  }

  it("ignores calls without an id and duplicate call ids", async () => {
    const deps = makeCallDeps(async () => ({ success: true }));
    await handleAtlasVoiceFunctionCall({ name: "read_current_place" }, deps);
    await handleAtlasVoiceFunctionCall(
      { call_id: "a", name: "read_current_place" },
      deps,
    );
    await handleAtlasVoiceFunctionCall(
      { call_id: "a", name: "read_current_place" },
      deps,
    );
    expect(deps.executeTool).toHaveBeenCalledTimes(1);
  });

  it("allows only one navigation attempt per user turn", async () => {
    const deps = makeCallDeps(async () => ({ success: false }));
    await handleAtlasVoiceFunctionCall(
      { call_id: "1", name: "navigate", arguments: '{"mode":"random"}' },
      deps,
    );
    expect(deps.executeTool).toHaveBeenCalledWith("navigate", {
      mode: "random",
    });
    expect(deps.navigationAttemptedRef.current).toBe(true);

    deps.sendEvent.mockClear();
    await handleAtlasVoiceFunctionCall(
      { call_id: "2", name: "wander_nearby", arguments: "{}" },
      deps,
    );
    expect(deps.executeTool).toHaveBeenCalledTimes(1);
    expect(sentOutput(deps)).toEqual({
      success: false,
      error: "A navigation action was already attempted in this user turn.",
      terminal: true,
      retry_allowed: false,
    });
  });

  it("marks thrown navigation errors terminal and other tool errors retryable", async () => {
    const deps = makeCallDeps(async () => {
      throw new Error("boom");
    });
    await handleAtlasVoiceFunctionCall(
      { call_id: "nav", name: "navigate" },
      deps,
    );
    expect(sentOutput(deps)).toEqual({
      success: false,
      error: "boom",
      terminal: true,
      retry_allowed: false,
    });

    deps.sendEvent.mockClear();
    await handleAtlasVoiceFunctionCall(
      { call_id: "look", name: "look_direction" },
      deps,
    );
    expect(sentOutput(deps)).toMatchObject({
      terminal: false,
      retry_allowed: true,
    });
  });

  it("attaches scene readiness for scene-changing results and requests a response", async () => {
    const deps = makeCallDeps(async () => ({
      success: true,
      action: "updated_heading",
      heading: 90,
    }));
    deps.sendLatestSceneContext.mockResolvedValue(false);

    await handleAtlasVoiceFunctionCall(
      { call_id: "turn", name: "look_direction", arguments: '{"heading":90}' },
      deps,
    );

    expect(deps.sendLatestSceneContext).toHaveBeenCalledWith({
      allowAuto: true,
    });
    expect(sentOutput(deps)).toEqual({
      success: true,
      action: "updated_heading",
      heading: 90,
      visual_context_ready: false,
    });
    expect(deps.sendEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "conversation.item.create",
      "response.create",
    ]);
    expect(deps.setStatus).toHaveBeenCalledWith("thinking");
    expect(deps.startResponseWatchdog).toHaveBeenCalledTimes(1);
  });

  it("does not wait for scene context when nothing moved", async () => {
    const deps = makeCallDeps(async () => ({ success: true, location: "X" }));
    await handleAtlasVoiceFunctionCall(
      { call_id: "read", name: "read_current_place" },
      deps,
    );
    expect(deps.sendLatestSceneContext).not.toHaveBeenCalled();
    expect(sentOutput(deps)).toEqual({ success: true, location: "X" });
  });

  it.each([
    ["theme without query", { mode: "theme" }],
    ["place without query", { mode: "place" }],
    ["invalid coordinates", { mode: "coordinates", lat: 200, lng: 0 }],
    ["nearby without a location", { mode: "nearby" }],
  ])(
    "sends outputs in call order when %s fails validation",
    async (_label, navigateArgs) => {
      useStore.setState({ location: null });
      const deps = makeCallDeps((name, args) =>
        executeAtlasVoiceTool(name, args, makeDeps()),
      );

      await Promise.all([
        handleAtlasVoiceFunctionCall(
          {
            call_id: "nav",
            name: "navigate",
            arguments: JSON.stringify(navigateArgs),
          },
          deps,
        ),
        handleAtlasVoiceFunctionCall(
          { call_id: "read", name: "read_current_place" },
          deps,
        ),
      ]);

      const outputOrder = deps.sendEvent.mock.calls
        .map(([sent]) => sent)
        .filter((sent) => sent.type === "conversation.item.create")
        .map((sent) => sent.item.call_id);
      expect(outputOrder).toEqual(["nav", "read"]);
    },
  );
});
