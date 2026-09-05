const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "navigate",
    description:
      "Perform exactly one location-changing action. Pick one mode: random for a fresh surprise, theme for a broad kind of place, place for a concrete named target, coordinates for exact latitude/longitude, or nearby for a short walk from the current scene. Never retry with another mode in the same user turn.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["random", "theme", "place", "coordinates", "nearby"],
          description: "The single navigation intent for this turn.",
        },
        query: {
          type: "string",
          description:
            "For theme mode, the broad exploration theme. For place mode, the concrete landmark, business, address, or place name to search.",
        },
        lat: {
          type: "number",
          description:
            "Required for coordinates mode; latitude between -90 and 90.",
        },
        lng: {
          type: "number",
          description:
            "Required for coordinates mode; longitude between -180 and 180.",
        },
        direction: {
          type: "string",
          enum: [
            "north",
            "northeast",
            "east",
            "southeast",
            "south",
            "southwest",
            "west",
            "northwest",
            "forward",
            "left",
            "right",
            "back",
          ],
          description:
            "Optional direction to walk. Use forward for a vague nearby walk.",
        },
        distance_meters: {
          type: "number",
          description:
            "Approximate distance to move. Keep it small for walking, usually 120-450.",
        },
      },
      required: ["mode"],
    },
  },
  {
    type: "function",
    name: "look_direction",
    description:
      "Turn the Street View camera toward a cardinal direction, relative direction, or absolute heading.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: [
            "north",
            "northeast",
            "east",
            "southeast",
            "south",
            "southwest",
            "west",
            "northwest",
            "forward",
            "left",
            "right",
            "back",
          ],
          description:
            "Direction to look. Use left/right/back relative to the current heading.",
        },
        heading: {
          type: "number",
          description:
            "Absolute heading in degrees, where 0 is north and 90 is east.",
        },
      },
    },
  },
  {
    type: "function",
    name: "read_current_place",
    description:
      "Get the current Street View location, current heading, and visible Atlas description.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

export { TOOL_DEFINITIONS };
