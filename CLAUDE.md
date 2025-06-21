# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Street View exploration website where users can randomly explore global street views with AI-generated descriptions. The project features a React frontend with Google Maps/Street View integration and a Go backend with Redis caching.

## Architecture

**Frontend (React + TypeScript)**
- React 18 with TypeScript
- Google Maps/Street View API integration
- i18next for internationalization
- Component-based architecture with hooks

**Backend (Go + Gin)**
- Go 1.22+ with Gin framework
- Redis for caching and data storage
- OpenRouter AI API integration
- REST API with POST JSON endpoints

**Infrastructure**
- Docker Compose for orchestration
- Nginx as reverse proxy
- Redis for caching
- Cloudflare for CDN/proxy

## Development Commands

### Frontend Development
```bash
cd frontend
yarn install
yarn start      # Development server
yarn build      # Production build
yarn test       # Run tests
yarn lint       # ESLint
yarn format     # Prettier formatting
```

### Backend Development
```bash
cd backend
go mod download
go run cmd/server/main.go                           # Normal run
go run cmd/server/main.go --proxy http://localhost:10086  # With proxy
go test ./...   # Run tests
```

### Full Development Environment
```bash
make dev-start  # Start both frontend and backend
make dev-stop   # Stop development environment
```

### Production Deployment
```bash
make deploy     # Build and deploy with Docker Compose
make clean      # Clean up containers and volumes
```

## Key Configuration

### Environment Variables
**Backend (.env)**
- `REDIS_ADDRESS`: Redis connection string
- `AI_API_KEY`: OpenRouter API key
- `SERVER_ADDRESS`: Server bind address

**Frontend (.env.local)**
- `REACT_APP_API_BASE_URL`: Backend API URL
- `REACT_APP_GOOGLE_MAPS_API_KEY`: Google Maps API key

## Core Architecture Patterns

### Location Grid System
- Coordinates are grid-quantized to 0.02-degree precision (~2-3km squares)
- Grid IDs format: `grid:40.7200:-74.0000`
- Reduces coordinate precision for caching efficiency

### Data Storage (Redis)
- `locations` SET: All location IDs for random selection
- `location:<location_id>` HASH: Location details (lat, lng)
- `ai_description:<location_id>` HASH: Cached AI descriptions with TTL

### API Endpoints
- `POST /random-streetview`: Get random location with description
- `POST /ai-description`: Get/generate AI description for location

### Frontend State Management
- React hooks for local state
- Custom hooks for complex logic (useLocationData, useUIHandlers)
- Session-based user tracking

## Testing

Frontend tests use React Testing Library. Backend uses Go's built-in testing framework.

## Key Files to Understand

**Frontend:**
- `src/pages/HomePage.jsx`: Main application page
- `src/hooks/`: Custom React hooks for state management
- `src/services/api.js`: Backend API integration

**Backend:**
- `cmd/server/main.go`: Application entry point
- `internal/api/handlers.go`: HTTP request handlers
- `internal/services/`: Business logic services
- `internal/repositories/`: Data access layer

## Development Notes

- The project uses a unified POST JSON API pattern
- AI descriptions are cached to reduce API costs
- Grid quantization is critical for location caching strategy
- Frontend proxy configuration points to backend:8080
- Redis is used instead of traditional database for simplicity