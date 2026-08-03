import React, { memo } from "react";

const STREETVIEW_IMAGE_PATH = "/api/v1/agent/streetview";
const PANO_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;

function safeInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function buildSafeStreetViewSource(source, journeyId) {
  if (!source || !journeyId) return null;

  try {
    const parsed = new URL(source, window.location.origin);
    if (
      parsed.origin !== window.location.origin ||
      parsed.pathname !== STREETVIEW_IMAGE_PATH
    ) {
      return null;
    }

    const panoId = parsed.searchParams.get("pano_id") || "";
    if (!PANO_ID_PATTERN.test(panoId)) return null;

    const params = new URLSearchParams({
      pano_id: panoId,
      heading: String(
        safeInteger(parsed.searchParams.get("heading"), 0, 360, 0),
      ),
      journey_id: journeyId,
    });
    const pitch = parsed.searchParams.get("pitch");
    const fov = parsed.searchParams.get("fov");
    if (pitch !== null) {
      params.set("pitch", String(safeInteger(pitch, -90, 90, 0)));
    }
    if (fov !== null) {
      params.set("fov", String(safeInteger(fov, 10, 120, 90)));
    }

    return `${STREETVIEW_IMAGE_PATH}?${params.toString()}`;
  } catch {
    return null;
  }
}

function resolveLetterImageSource(rawUrl, stopImageMap, journeyId) {
  const stopMatch = rawUrl.match(
    /(?:^|[/_.-])stop[_-]?(\d+)(?:\.[A-Za-z0-9]+)?$/i,
  );
  if (stopMatch) {
    return buildSafeStreetViewSource(
      stopImageMap[Number.parseInt(stopMatch[1], 10)],
      journeyId,
    );
  }

  let requestedPanoId = "";
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (
      parsed.origin !== window.location.origin ||
      parsed.pathname !== STREETVIEW_IMAGE_PATH
    ) {
      return null;
    }
    requestedPanoId = parsed.searchParams.get("pano_id") || "";
  } catch {
    return null;
  }

  for (const source of Object.values(stopImageMap)) {
    try {
      const parsedSource = new URL(source, window.location.origin);
      if (parsedSource.searchParams.get("pano_id") === requestedPanoId) {
        return buildSafeStreetViewSource(source, journeyId);
      }
    } catch {
      // Ignore malformed stop metadata instead of rendering an unsafe URL.
    }
  }
  return null;
}

function renderBoldText(text, keyPrefix) {
  const nodes = [];
  let cursor = 0;
  let match;
  BOLD_PATTERN.lastIndex = 0;
  while ((match = BOLD_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(
      <strong key={`${keyPrefix}-bold-${match.index}`}>{match[1]}</strong>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderInline(text, stopImageMap, journeyId, keyPrefix) {
  const nodes = [];
  let cursor = 0;
  let match;
  IMAGE_PATTERN.lastIndex = 0;
  while ((match = IMAGE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(
        ...renderBoldText(
          text.slice(cursor, match.index),
          `${keyPrefix}-${cursor}`,
        ),
      );
    }

    const src = resolveLetterImageSource(match[2], stopImageMap, journeyId);
    if (src) {
      nodes.push(
        <img
          key={`${keyPrefix}-image-${match.index}`}
          src={src}
          alt={match[1]}
          loading="lazy"
          className="agent-letter-img"
        />,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    nodes.push(...renderBoldText(text.slice(cursor), `${keyPrefix}-${cursor}`));
  }
  return nodes;
}

const LetterContent = memo(function LetterContent({
  text,
  stopImageMap = {},
  journeyId,
}) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  return (
    <div className="agent-letter-content">
      {lines.map((line, index) => {
        const key = `letter-line-${index}`;
        if (line === "---") return <hr key={key} className="agent-letter-hr" />;

        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
          return (
            <Tag key={key} className={`agent-letter-h${level}`}>
              {renderInline(heading[2], stopImageMap, journeyId, key)}
            </Tag>
          );
        }

        return (
          <React.Fragment key={key}>
            {renderInline(line, stopImageMap, journeyId, key)}
            <br />
          </React.Fragment>
        );
      })}
    </div>
  );
});

export default LetterContent;
