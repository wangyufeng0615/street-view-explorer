# Street View Explorer

https://earth.wangyufeng.org/

A web application for randomly exploring global street views with AI-generated descriptions.

## Features

- 🎲 Random street view exploration powered by Google Street View
- 🤖 AI-generated location descriptions via OpenRouter API
- 🌐 Multi-language support (English/Chinese)
- ⚡ Redis caching for optimal performance

## Quick Start

### Development
```bash
# Frontend
cd frontend && yarn install && yarn start

# Backend
cd backend && go run cmd/server/main.go `[--proxy http://ADDRESS:PORT`]
```

### Production
```bash
make deploy
```

## Configuration

### Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your API keys and configuration
```

### Frontend Setup
```bash
cd frontend  
cp .env.example .env
# Edit .env with your Google Maps API key
```

### Required API Keys
- **OpenRouter API**: For AI description generation
- **Google Maps API**: For maps and street view (separate keys recommended for frontend/backend)

## Tech Stack

- **Frontend**: React 18 + TypeScript + Google Maps API
- **Backend**: Go + Gin + Redis
- **AI**: OpenRouter API integration
- **Infrastructure**: Docker Compose + Nginx