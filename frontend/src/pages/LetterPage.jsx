import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "../styles/AgentPage.css";

const API_V1 = "/api/v1";

// Same renderer as AgentPage
function renderLetterMarkdown(text, stopImageMap = {}) {
  const images = [];
  let processed = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      let src = "";
      if (url.includes("/api/v1/agent/streetview")) {
        src = url;
      } else {
        const stopMatch = url.match(/stop[_-]?(\d+)/i);
        if (stopMatch && stopImageMap[parseInt(stopMatch[1], 10)]) {
          src = stopImageMap[parseInt(stopMatch[1], 10)];
        }
      }
      if (!src) return "";
      const idx = images.length;
      images.push(`<img src="${src}" alt="${alt}" loading="lazy" class="agent-letter-img" />`);
      return `\x00IMG${idx}\x00`;
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
  processed = processed.replace(/\x00IMG(\d+)\x00/g, (_, idx) => images[parseInt(idx, 10)]);

  return processed;
}

export default function LetterPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [letter, setLetter] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`${API_V1}/agent/journeys/${id}/public-letter`);
        const text = await resp.text();
        if (!text) { setError("Empty response"); return; }
        const data = JSON.parse(text);
        if (data.success && data.data) {
          setLetter(data.data.letter);
          setPhotos(data.data.photos || []);
          setToken(data.data.token || "");
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
        `/api/v1/agent/streetview?pano_id=${p.pano_id}&heading=${p.photo_heading || 0}&token=${token}`;
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
            dangerouslySetInnerHTML={{ __html: renderLetterMarkdown(letter, stopImageMap) }}
          />
        </div>
      </div>
    </div>
  );
}
