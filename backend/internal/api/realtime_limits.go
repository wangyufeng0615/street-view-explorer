package api

import (
	"sync"
	"time"
)

const (
	realtimeMaxConnections      = 16
	realtimeMaxConnectionsPerIP = 2
	realtimeMaxMessageBytes     = 4 << 20
	realtimeMaxSessionDuration  = 15 * time.Minute
	realtimeIdleTimeout         = 90 * time.Second
	realtimeWriteTimeout        = 10 * time.Second
)

func (h *RealtimeHandlers) reserveRealtimeConnection(ip string) (func(), bool) {
	h.connectionsMu.Lock()
	defer h.connectionsMu.Unlock()
	if h.activeConnections >= realtimeMaxConnections || h.connections[ip] >= realtimeMaxConnectionsPerIP {
		return nil, false
	}
	if h.connections == nil {
		h.connections = make(map[string]int)
	}
	h.connections[ip]++
	h.activeConnections++
	var once sync.Once
	return func() {
		once.Do(func() {
			h.connectionsMu.Lock()
			defer h.connectionsMu.Unlock()
			h.connections[ip]--
			h.activeConnections--
			if h.connections[ip] == 0 {
				delete(h.connections, ip)
			}
		})
	}, true
}
