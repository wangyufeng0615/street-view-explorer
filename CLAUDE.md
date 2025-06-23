# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Street View exploration website where users can randomly explore global street views with AI-generated descriptions. The project features a React frontend with Google Maps/Street View integration and a Go backend with Redis caching. Users can set exploration preferences to get personalized location recommendations based on their interests.

## Architecture

**Frontend (React + TypeScript)**
- React 18 with TypeScript
- Google Maps/Street View API integration  
- i18next for internationalization (supports en/zh)
- Component-based architecture with custom hooks
- Session-based state management
- Responsive design with CSS modules

**Backend (Go + Gin)**
- Go 1.22.2 with Gin framework
- Redis for caching and session storage
- OpenRouter AI API integration
- RESTful API with structured logging
- Session middleware for user tracking
- Natural Earth geographic data integration

**Infrastructure**
- Docker Compose orchestration with health checks
- Nginx reverse proxy with caching
- Redis with persistent storage
- Geographic data files (GeoJSON format)

## Development Commands

### Frontend Development
```bash
cd frontend
yarn install
yarn start      # Development server at localhost:3000
yarn build      # Production build
yarn test       # Run tests with React Testing Library
yarn lint       # ESLint with TypeScript support
yarn format     # Prettier formatting
```

### Backend Development
```bash
cd backend
go mod download
go run cmd/server/main.go                           # Normal run on :8080
go run cmd/server/main.go --proxy http://localhost:10086  # With proxy
go test ./...   # Run all tests
```

### Production Deployment
```bash
make deploy     # Build and deploy with Docker Compose
make clean      # Clean up containers and volumes
```

## Key Configuration

### Environment Variables
**Backend (.env)**
- `REDIS_ADDRESS`: Redis connection string (default: localhost:6379)
- `AI_API_KEY`: OpenRouter API key for AI descriptions
- `SERVER_ADDRESS`: Server bind address (default: :8080)

**Frontend (.env)**
- `REACT_APP_API_BASE_URL`: Backend API URL
- `REACT_APP_GOOGLE_MAPS_API_KEY`: Google Maps API key

## Core Architecture Patterns

### Session Management
- UUID-based session tracking via cookies
- Session middleware handles user identification
- Exploration preferences stored per session

### Location Grid System
- Coordinates quantized to 0.02-degree precision (~2-3km squares)
- Grid IDs format: `grid:40.7200:-74.0000`
- Natural Earth data for geographic boundaries
- Smart filtering based on user preferences

### Data Storage (Redis)
- `locations` SET: All available location IDs
- `location:<location_id>` HASH: Location details (lat, lng, country)
- `ai_description:<location_id>:<lang>` HASH: Cached AI descriptions with TTL
- `session:<session_id>:preference` STRING: User exploration preferences
- `conversation:<location_id>:<lang>` HASH: AI conversation history

### API Endpoints (RESTful)
**Location Management:**
- `GET /api/v1/locations/random?lang=<lang>`: Get random location with description
- `GET /api/v1/locations/:panoId/description?lang=<lang>`: Get location description
- `GET /api/v1/locations/:panoId/detailed-description?lang=<lang>`: Get detailed description

**User Preferences:**
- `POST /api/v1/preferences/exploration`: Set exploration preference
- `POST /api/v1/preferences/exploration/remove`: Delete exploration preference

### Frontend State Management
- Custom hooks for complex logic:
  - `useLocationData`: Location state and data fetching
  - `useUIHandlers`: UI interaction handlers
  - `useExplorationMode`: User preference management
  - `useKeyboardNavigation`: Keyboard shortcuts
  - `useLocationDescription`: AI description management
- Session-based user tracking with localStorage backup

### Logging System
- Structured logging with request IDs
- Performance monitoring with duration tracking
- Error categorization and status code mapping
- API request/response logging

## Testing

- **Frontend**: React Testing Library with Jest
- **Backend**: Go built-in testing framework with table-driven tests
- **Integration**: Docker Compose for full stack testing

## Key Files to Understand

**Frontend Structure:**
- `src/pages/HomePage.jsx`: Main application page with layout
- `src/hooks/`: Custom React hooks for state management
- `src/components/`: Reusable UI components
  - `StreetViewContainer.jsx`: Google Street View integration
  - `NewSidebar.jsx`: Main UI sidebar with controls
  - `ExplorationPreference.jsx`: User preference settings
- `src/services/api.js`: Backend API integration with error handling
- `src/utils/`: Utility functions for sessions, maps, addresses

**Backend Structure:**
- `cmd/server/main.go`: Application entry point with CLI flags
- `internal/api/`: HTTP layer
  - `handlers.go`: Request handlers with validation
  - `routes.go`: Route definitions
  - `middleware.go`: Session and CORS middleware
- `internal/services/`: Business logic
  - `location_service.go`: Location management and preferences
  - `ai_service.go`: AI description generation
  - `maps_service.go`: Geographic data processing
- `internal/repositories/`: Data access layer
- `internal/utils/`: Utilities (logging, geo calculations, proxy)
- `data/maps/`: Geographic data files (GeoJSON)

## Development Notes

### API Design Patterns
- RESTful endpoints with consistent response format
- Language parameter support (en/zh) via query string
- Session-based user context via middleware
- Structured error responses with duration tracking

### Caching Strategy
- AI descriptions cached with language-specific keys
- Conversation history for detailed descriptions
- Location grid quantization for efficient caching
- TTL-based cache expiration

### Geographic Data
- Natural Earth high-resolution geographic boundaries
- Land/water distinction for location filtering
- Country-based location categorization
- Coordinate validation and boundary checking  

### Internationalization
- Frontend: i18next with language detection
- Backend: Language-aware AI prompts and responses
- Default languages: English (frontend), Chinese (AI descriptions)

### Performance Considerations
- Redis caching reduces AI API costs
- Geographic data pre-loaded at startup
- Concurrent request handling with goroutines
- Frontend lazy loading and code splitting