package api

import (
	"sync"
	"time"
)

const (
	prefetchTTL           = 15 * time.Minute
	prefetchPerSession    = 2
	prefetchMaxSessions   = 10000
	prefetchSweepInterval = time.Minute
)

// prefetchRegistry remembers which panoramas a session fetched ahead of time
// with /locations/random?prefetch=1. Those responses skip the footprint write;
// the visit is recorded only when the page actually shows the place and calls
// POST /locations/:panoId/visit. Requiring a matching, unexpired, single-use
// entry keeps that endpoint from writing arbitrary places into the shared
// footprint map. The registry is in memory: a restart only loses footprints
// for places prefetched but not yet shown.
type prefetchRegistry struct {
	mu        sync.Mutex
	sessions  map[string]map[string]time.Time // session -> pano -> expiry
	now       func() time.Time
	lastSweep time.Time
}

func newPrefetchRegistry() *prefetchRegistry {
	return &prefetchRegistry{sessions: make(map[string]map[string]time.Time), now: time.Now}
}

// add records a prefetched panorama, keeping only the newest entries per
// session and dropping new sessions once the registry is full.
func (r *prefetchRegistry) add(sessionID, panoID string) {
	if r == nil || sessionID == "" || panoID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	r.sweepLocked(now)

	entries := r.sessions[sessionID]
	if entries == nil {
		if len(r.sessions) >= prefetchMaxSessions {
			return
		}
		entries = make(map[string]time.Time)
		r.sessions[sessionID] = entries
	}
	entries[panoID] = now.Add(prefetchTTL)
	for len(entries) > prefetchPerSession {
		oldest, oldestExpiry := "", time.Time{}
		for pano, expiry := range entries {
			if oldest == "" || expiry.Before(oldestExpiry) {
				oldest, oldestExpiry = pano, expiry
			}
		}
		delete(entries, oldest)
	}
}

// take consumes a pending entry. It reports false when the session never
// prefetched the panorama, already used it, or it expired.
func (r *prefetchRegistry) take(sessionID, panoID string) bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	entries := r.sessions[sessionID]
	expiry, ok := entries[panoID]
	if !ok {
		return false
	}
	delete(entries, panoID)
	if len(entries) == 0 {
		delete(r.sessions, sessionID)
	}
	return r.now().Before(expiry)
}

func (r *prefetchRegistry) sweepLocked(now time.Time) {
	if now.Sub(r.lastSweep) < prefetchSweepInterval {
		return
	}
	r.lastSweep = now
	for session, entries := range r.sessions {
		for pano, expiry := range entries {
			if !now.Before(expiry) {
				delete(entries, pano)
			}
		}
		if len(entries) == 0 {
			delete(r.sessions, session)
		}
	}
}
