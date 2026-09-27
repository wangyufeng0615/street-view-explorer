import {
  deleteExplorationPreference,
  searchLocation,
  setExplorationPreference,
} from "../services/api";
import useStore from "../store/useStore";
import { formatAtlasLocation, truncateAtlasText } from "./atlasPersona";
import {
  normalizeHeading,
  headingFromDirection,
  destinationPoint,
  clampNumber,
  nearbyBearing,
} from "./atlasVoiceNavigation";

/** Tool results whose action moved the camera, so a fresh frame is needed. */
export const SCENE_CHANGING_ACTIONS = new Set([
  "loaded_random_location",
  "loaded_interest_location",
  "loaded_coordinates",
  "loaded_place_search",
  "wandered_nearby",
  "updated_heading",
]);

/** Current tool plus legacy aliases; only one of these may run per user turn. */
export const NAVIGATION_TOOL_NAMES = [
  "navigate",
  "explore_random",
  "explore_interest",
  "go_to_place",
  "wander_nearby",
];

export function parseToolArguments(rawArguments) {
  let args = {};
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch (err) {
    args = {};
  }
  return args;
}

/** Maps legacy tool names onto the single `navigate` tool. */
export function normalizeLegacyToolCall(name, args) {
  const legacyModes = {
    explore_random: "random",
    explore_interest: "theme",
    go_to_place: Number.isFinite(Number(args?.lat)) ? "coordinates" : "place",
    wander_nearby: "nearby",
  };
  if (Object.prototype.hasOwnProperty.call(legacyModes, name)) {
    return {
      name: "navigate",
      args: {
        ...(args || {}),
        mode: legacyModes[name],
        query: args?.query || args?.interest,
      },
    };
  }
  return { name, args };
}

export function summarizeCurrentPlace(noLocationMessage) {
  const state = useStore.getState();
  const activeLocation = state.location || state.currentLocationRef;
  if (!activeLocation) {
    return {
      success: false,
      message: noLocationMessage,
    };
  }

  return {
    success: true,
    location: formatAtlasLocation(activeLocation),
    heading: Math.round(state.heading || 0),
    description: truncateAtlasText(state.description || "", 1200),
  };
}

function terminalFailure(error, extra = {}) {
  return {
    success: false,
    error,
    ...extra,
    terminal: true,
    retry_allowed: false,
  };
}

async function navigateRandom({ language, noLocationMessage, sendScene }) {
  await deleteExplorationPreference(language);
  window.localStorage?.setItem("exploration_mode", "random");
  window.localStorage?.removeItem("exploration_interest");
  useStore.setState({
    explorationMode: "random",
    explorationInterest: "",
    preferenceError: null,
  });
  await useStore.getState().loadRandomLocation(true);
  sendScene();
  return {
    success: true,
    action: "loaded_random_location",
    ...summarizeCurrentPlace(noLocationMessage),
  };
}

// Validation failures in the navigate helpers below return synchronously, like
// the original inline executeTool branches. Returning them from an async
// function would settle a few microtasks later and reorder function_call_output
// events when one response carries several tool calls.
function navigateTheme(args, context) {
  const interest = String(args?.query || "").trim();
  if (!interest) {
    return terminalFailure("Missing exploration theme");
  }
  return applyExplorationTheme(interest, context);
}

async function applyExplorationTheme(
  interest,
  { language, noLocationMessage, sendScene },
) {
  const preference = await setExplorationPreference(interest, language);
  if (!preference.success) {
    return terminalFailure(
      preference.error || "Failed to set exploration preference",
    );
  }

  window.localStorage?.setItem("exploration_mode", "custom");
  window.localStorage?.setItem("exploration_interest", interest);
  useStore.setState({
    explorationMode: "custom",
    explorationInterest: interest,
    preferenceError: null,
  });
  await useStore.getState().loadRandomLocation(true);
  sendScene();
  return {
    success: true,
    action: "loaded_interest_location",
    interest,
    ...summarizeCurrentPlace(noLocationMessage),
  };
}

function navigateToPlaceOrCoordinates(args, state, context) {
  const lat = Number(args?.lat);
  const lng = Number(args?.lng);
  const hasCoordinates =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  if (args?.mode === "coordinates" && hasCoordinates) {
    return loadCoordinates(lat, lng, state, context);
  }

  if (args?.mode === "coordinates") {
    return terminalFailure(
      "Coordinates mode requires a valid latitude and longitude.",
    );
  }

  const query = String(args?.query || "").trim();
  if (!query) {
    return terminalFailure(
      "Provide a concrete place query or valid coordinates.",
    );
  }
  return loadPlaceSearch(query, context);
}

async function loadCoordinates(
  lat,
  lng,
  state,
  { noLocationMessage, sendScene },
) {
  await state.loadLocationFromURL(lat, lng);
  const nextLocation = useStore.getState().location;
  if (!nextLocation?.pano_id) {
    return terminalFailure("Could not find Street View near those coordinates");
  }
  sendScene();
  return {
    success: true,
    action: "loaded_coordinates",
    ...summarizeCurrentPlace(noLocationMessage),
  };
}

async function loadPlaceSearch(
  query,
  { language, noLocationMessage, sendScene },
) {
  const result = await searchLocation(query, language);
  if (!result.success || !result.data) {
    return terminalFailure(result.error || "Could not find that place", {
      place: result.place || null,
    });
  }

  const locLat = Number(result.data.latitude);
  const locLng = Number(result.data.longitude);
  if (!Number.isFinite(locLat) || !Number.isFinite(locLng)) {
    return terminalFailure("Search returned invalid coordinates");
  }

  const locationData = {
    ...result.data,
    latitude: locLat,
    longitude: locLng,
  };
  useStore.setState({
    location: locationData,
    currentLocationRef: locationData,
    locationError: null,
    description: null,
    descriptionError: null,
    streetViewView: null,
  });
  sendScene();

  return {
    success: true,
    action: "loaded_place_search",
    query,
    matched_place: result.place || null,
    ...summarizeCurrentPlace(noLocationMessage),
  };
}

function wanderNearby(args, state, context) {
  if (!state.location) {
    return { success: false, message: context.noLocationMessage };
  }

  const startLat = Number(state.location.latitude);
  const startLng = Number(state.location.longitude);
  if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
    return {
      success: false,
      error: "Current location has invalid coordinates",
    };
  }
  return walkNearbyAttempts(args, state, startLat, startLng, context);
}

async function walkNearbyAttempts(
  args,
  state,
  startLat,
  startLng,
  { noLocationMessage, sendScene },
) {
  const distanceMeters = clampNumber(args?.distance_meters, 80, 900, 240);
  const requestedBearing = nearbyBearing(args?.direction, state.heading);
  const attempts = [
    [requestedBearing, distanceMeters],
    [normalizeHeading(requestedBearing + 35), distanceMeters * 1.5],
    [normalizeHeading(requestedBearing - 45), distanceMeters * 1.8],
  ];

  for (const [bearing, distance] of attempts) {
    const next = destinationPoint(startLat, startLng, bearing, distance);
    await useStore.getState().loadLocationFromURL(next.lat, next.lng);
    const nextLocation = useStore.getState().location;
    if (nextLocation?.pano_id) {
      sendScene();
      return {
        success: true,
        action: "wandered_nearby",
        direction: args?.direction || "forward",
        distance_meters: Math.round(distance),
        ...summarizeCurrentPlace(noLocationMessage),
      };
    }
  }

  return terminalFailure(
    "Could not find nearby Street View after a few tries",
    { original_location: formatAtlasLocation(state.location) },
  );
}

function lookDirection(args, state, { sendScene }) {
  const explicitHeading = Number(args?.heading);
  const nextHeading = Number.isFinite(explicitHeading)
    ? normalizeHeading(explicitHeading)
    : headingFromDirection(args?.direction, state.heading);

  if (nextHeading === null) {
    return {
      success: false,
      error:
        "Please provide a heading in degrees or a direction like north, east, left, right, or back.",
    };
  }

  if (typeof state.setHeading === "function") {
    state.setHeading(nextHeading);
  } else {
    useStore.setState({ heading: nextHeading });
  }
  const currentView = useStore.getState().streetViewView;
  if (currentView?.panoId) {
    useStore.getState().setStreetViewView?.({
      ...currentView,
      heading: nextHeading,
      source: "programmatic",
    });
  }
  sendScene();

  return {
    success: true,
    action: "updated_heading",
    heading: Math.round(nextHeading),
  };
}

/**
 * Runs one Atlas Voice tool against the global store and API.
 *
 * @param {string} rawName tool name from the Realtime function call
 * @param {object} rawArgs parsed tool arguments
 * @param {{
 *   language: string,
 *   noLocationMessage: string,
 *   sendLatestSceneContext: (options?: { allowAuto?: boolean }) => Promise<boolean>,
 * }} deps
 */
export async function executeAtlasVoiceTool(rawName, rawArgs, deps) {
  const state = useStore.getState();
  const { name, args } = normalizeLegacyToolCall(rawName, rawArgs);
  const context = {
    language: deps.language,
    noLocationMessage: deps.noLocationMessage,
    sendScene: () => {
      void deps.sendLatestSceneContext({ allowAuto: true });
    },
  };

  if (name === "read_current_place") {
    return summarizeCurrentPlace(deps.noLocationMessage);
  }

  if (name === "navigate" && args?.mode === "random") {
    return navigateRandom(context);
  }

  if (name === "navigate" && args?.mode === "theme") {
    return navigateTheme(args, context);
  }

  if (name === "navigate" && ["place", "coordinates"].includes(args?.mode)) {
    return navigateToPlaceOrCoordinates(args, state, context);
  }

  if (name === "navigate" && args?.mode === "nearby") {
    return wanderNearby(args, state, context);
  }

  if (name === "navigate") {
    return terminalFailure("Unknown navigation mode");
  }

  if (name === "look_direction") {
    return lookDirection(args, state, context);
  }

  return { success: false, error: `Unknown tool: ${name}` };
}

/**
 * Handles one Realtime function call end to end: dedupes by call id, enforces
 * one navigation attempt per user turn, runs the tool, attaches scene
 * readiness and asks Realtime for the follow-up response.
 */
export async function handleAtlasVoiceFunctionCall(
  functionCall,
  {
    handledCallIdsRef,
    navigationAttemptedRef,
    executeTool,
    sendEvent,
    sendLatestSceneContext,
    setStatus,
    startResponseWatchdog,
  },
) {
  if (
    !functionCall?.call_id ||
    handledCallIdsRef.current.has(functionCall.call_id)
  ) {
    return;
  }
  handledCallIdsRef.current.add(functionCall.call_id);

  const args = parseToolArguments(functionCall.arguments);

  let output;
  const isNavigationCall = NAVIGATION_TOOL_NAMES.includes(functionCall.name);
  if (isNavigationCall && navigationAttemptedRef.current) {
    output = terminalFailure(
      "A navigation action was already attempted in this user turn.",
    );
  } else {
    if (isNavigationCall) navigationAttemptedRef.current = true;
    try {
      output = await executeTool(functionCall.name, args);
    } catch (err) {
      output = {
        success: false,
        error: err.message || "Tool execution failed",
        terminal: isNavigationCall,
        retry_allowed: !isNavigationCall,
      };
    }
  }

  if (output?.success && SCENE_CHANGING_ACTIONS.has(output.action)) {
    const sceneReady = await sendLatestSceneContext({ allowAuto: true });
    output = { ...output, visual_context_ready: sceneReady };
  }

  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: functionCall.call_id,
      output: JSON.stringify(output),
    },
  });
  sendEvent({ type: "response.create" });
  setStatus("thinking");
  startResponseWatchdog();
}
