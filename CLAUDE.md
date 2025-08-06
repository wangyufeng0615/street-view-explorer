# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Street View Explorer - A web application for random global street view exploration with AI-generated descriptions. Live at: https://earth.wangyufeng.org/

Tech stack: React (TypeScript) frontend, Go backend with Gin framework, Redis caching, Docker Compose deployment, Nginx reverse proxy.

## Common Development Commands

### Frontend Development
```bash
cd frontend
yarn install           # Install dependencies
yarn start             # Start dev server (port 3000)
yarn build             # Production build
yarn lint              # Run ESLint
yarn format            # Format code with Prettier
yarn test              # Run tests
```

### Backend Development
```bash
cd backend
go run cmd/server/main.go                    # Start server (port 8080)
go test ./...                                 # Run all tests
go test ./internal/services/geo -v           # Run specific geo service tests
go test -bench=. ./internal/services/geo     # Run benchmarks
```

### Full Stack Development
```bash
make deploy            # Build and deploy with Docker Compose
make clean             # Clean up Docker containers
docker-compose up      # Start all services
docker-compose down    # Stop all services
```

## Architecture & Code Structure

### Frontend Architecture
- **Components**: Functional React components with TypeScript in `frontend/src/components/`
- **Pages**: Route-level components in `frontend/src/pages/`
- **Services**: API clients in `frontend/src/services/` (maps.ts, openai.ts)
- **Hooks**: Custom React hooks for state management in `frontend/src/hooks/`
- **i18n**: Translations in `frontend/public/locales/` (en/zh)
- **State Management**: React Context API with custom hooks
- **Styling**: CSS modules in `frontend/src/styles/`

### Backend Architecture
- **Entry Point**: `backend/cmd/server/main.go`
- **API Layer**: HTTP handlers in `backend/internal/api/handlers/` with Gin routing
- **Services**: Business logic separated by domain:
  - `location_service.go`: Random coordinate generation with land mass validation
  - `ai_service.go`: OpenRouter API integration for descriptions
  - `maps_service.go`: Google Maps API proxy
  - `geo/geo.go`: Geographic processing with GeoJSON polygons
- **Middleware**: Rate limiting, CORS, logging, error handling in `backend/internal/api/middleware/`
- **Repository Pattern**: Redis caching abstraction in `backend/internal/repositories/`
- **Geographic Data**: Natural Earth data in `backend/data/maps/ne_10m_land.geojson`

### Key Implementation Details

1. **Random Location Generation**: Uses area-weighted region selection from GeoJSON polygons to ensure uniform global distribution
2. **Caching Strategy**: Redis caches AI descriptions and geocoding results with TTL
3. **Error Handling**: Sentry integration for both frontend and backend monitoring
4. **API Proxy**: Backend proxies Google Maps API calls to protect API keys
5. **Rate Limiting**: Redis-backed rate limiting per IP address
6. **Internationalization**: React i18next with language detection and switching

## Environment Configuration

### Backend (.env)
```
PORT=8080
OPENROUTER_API_KEY=your_key
GOOGLE_MAPS_API_KEY=your_key
REDIS_ADDR=localhost:6379
SENTRY_DSN=your_dsn
SENTRY_ENVIRONMENT=development
```

### Frontend (.env)
```
REACT_APP_GOOGLE_MAPS_API_KEY=your_key
REACT_APP_API_BASE_URL=http://localhost:8080/api
REACT_APP_SENTRY_DSN=your_dsn
REACT_APP_SENTRY_ENVIRONMENT=development
```

## Testing Approach

- **Backend**: Standard Go testing with comprehensive geo service tests including polygon validation, random coordinate generation, and performance benchmarks
- **Frontend**: React Testing Library setup, run with `yarn test`
- **Key Test Files**: 
  - `backend/internal/services/geo/geo_test.go`: Geographic algorithm tests
  - `backend/internal/config/config_test.go`: Configuration tests

## Deployment

Production deployment uses Docker Compose with 4 services:
- `nginx`: Reverse proxy on port 3000
- `backend`: Go API server on port 8080
- `frontend`: React static files
- `redis`: Cache and session store

Deploy with: `make deploy`

## Important Patterns

1. **Service Interfaces**: Backend services use interfaces for testability
2. **Error Propagation**: Consistent error handling with Gin's error responses
3. **Logging**: Structured logging with log package
4. **CORS Configuration**: Configured for production domain with credentials
5. **Geographic Processing**: Complex polygon operations for land mass detection
6. **API Response Format**: Consistent JSON response structure with error messages