import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "../styles/AgentPage.css";

const API_V1 = "/api/v1";
const IMAGE_PLACEHOLDER_PREFIX = "__ATLAS_IMG_";
const IMAGE_PLACEHOLDER_SUFFIX = "__";

// Renderer for public letter — rewrites embedded token URLs to journey_id URLs
function renderLetterMarkdown(text, stopImageMap = {}, journeyId = null) {
  const images = [];
  let processed = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      let src = "";
      if (url.includes("/api/v1/agent/streetview")) {
        if (journeyId) {
          // Rewrite: strip token, use journey_id for public access
          try {
            const u = new URL(url, window.location.origin);
            u.searchParams.delete("token");
            u.searchParams.set("journey_id", journeyId);
            src = u.pathname + "?" + u.searchParams.toString();
          } catch {
            src = url;
          }
        } else {
          src = url;
        }
      } else {
        const stopMatch = url.match(/stop[_-]?(\d+)/i);
        if (stopMatch && stopImageMap[parseInt(stopMatch[1], 10)]) {
          src = stopImageMap[parseInt(stopMatch[1], 10)];
        }
      }
      if (!src) return "";
      const idx = images.length;
      images.push(`<img src="${src}" alt="${alt}" loading="lazy" class="agent-letter-img" />`);
      return `${IMAGE_PLACEHOLDER_PREFIX}${idx}${IMAGE_PLACEHOLDER_SUFFIX}`;
    },
  );

  processed = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  processed = processed.replace(/^### (.+)$/gm, '<h4 class="agent-letter-h3">$1</h4>');
  processed = processed.replace(/^## (.+)$/gm, '<h3 class="agent-letter-h2">$1</h3>');
  processed = processed.replace(/^# (.+)$/gm, '<h2 class="agent-letter-h1">$1</h2>');
  processed = processed.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  processed = processed.replace(/^---$/gm, '<hr class="agent-letter-hr" />');
  processed = processed.replace(/\n/g, "<br />");
  const imagePlaceholderPattern = new RegExp(
    `${IMAGE_PLACEHOLDER_PREFIX}(\\d+)${IMAGE_PLACEHOLDER_SUFFIX}`,
    "g",
  );
  processed = processed.replace(imagePlaceholderPattern, (_, idx) => images[parseInt(idx, 10)]);

  return processed;
}

export default function LetterPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [letter, setLetter] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!id || id === "undefined") {
        setError("Invalid letter ID");
        setLoading(false);
        return;
      }
      try {
        const resp = await fetch(`${API_V1}/agent/journeys/${id}/public-letter`);
        const text = await resp.text();
        if (!text) { setError("Empty response"); return; }
        const data = JSON.parse(text);
        if (data.success && data.data) {
          setLetter(data.data.letter);
          setPhotos(data.data.photos || []);
        } else {
          setError(data.error || "Letter not found");
        }
      } catch {
        setError("Failed to load letter");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const stopImageMap = {};
  for (const p of photos) {
    if (p.pano_id) {
      stopImageMap[p.stop_number] =
        `/api/v1/agent/streetview?pano_id=${p.pano_id}&heading=${p.photo_heading || 0}&journey_id=${id}`;
    }
  }

  if (loading) {
    return (
      <div className="agent-page">
        <div className="agent-header">
          <button className="agent-back-btn" onClick={() => navigate("/agent")}>← Atlas</button>
        </div>
        <div className="agent-content">
          <div className="agent-detail-state">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="agent-page">
        <div className="agent-header">
          <button className="agent-back-btn" onClick={() => navigate("/agent")}>← Atlas</button>
        </div>
        <div className="agent-content">
          <div className="agent-detail-state error"><div>{error}</div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-page">
      <div className="agent-header">
        <button className="agent-back-btn" onClick={() => navigate("/agent")}>← Atlas</button>
      </div>
      <div className="agent-content">
        <div className="agent-letter-section agent-letter-standalone">
          <div
            className="agent-letter-content"
            dangerouslySetInnerHTML={{ __html: renderLetterMarkdown(letter, stopImageMap, id) }}
          />
        </div>
      </div>
    </div>
  );
}
