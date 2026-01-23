# Street View Explorer 🌍

[![Live Demo](https://img.shields.io/badge/Live-earth.wangyufeng.org-blue)](https://earth.wangyufeng.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7.1-646CFF?logo=vite)](https://vitejs.dev/)

An immersive web application for exploring random street views around the world with AI-generated location descriptions. Discover new places, learn about different cultures, and virtually travel the globe from your browser.

## ✨ Features

### Core Functionality
- 🎲 **Random Global Exploration**: Instantly teleport to random street view locations worldwide
- 🤖 **AI-Powered Descriptions**: Get intelligent, context-aware descriptions of each location
- 🗺️ **Interactive Maps**: Dual map views - global overview and local preview
- 🌐 **Multi-language Support**: Full interface in English and Chinese
- ⌨️ **Keyboard Navigation**: Press Space to jump to the next random location
- 📱 **Responsive Design**: Optimized for desktop, tablet, and mobile devices

### Advanced Features
- 🎯 **Regional Preferences**: Focus exploration on specific continents or regions
- ⚡ **Lightning Fast**: Redis caching for instant repeated views
- 📊 **Real-time Monitoring**: Sentry integration for performance tracking
- 🔒 **Secure API Design**: Protected API keys with backend proxy
- 🌍 **Uniform Distribution**: Area-weighted algorithm ensures true global randomness
··
## 🚀 Quick Start

### Prerequisites
- Node.js 20+ and Yarn
- Go 1.22+
- Redis 7.2+
- Docker & Docker Compose (for production deployment)
- Google Maps API Key (with Maps JavaScript API, Street View API enabled)
- OpenRouter API Key (for AI descriptions)
- Supabase Project (for user authentication and database)

### Development Setup

#### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/street-view-explorer.git
cd street-view-explorer
```

#### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your API keys and configuration

# Install dependencies
go mod download

# Run the backend server
go run cmd/server/main.go

# Or with proxy support
go run cmd/server/main.go --proxy http://proxy:port
```

#### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
# Edit .env with your configuration (VITE_* variables)

# Install dependencies
yarn install

# Start Vite development server
yarn dev
```

The application will be available at http://localhost:3000

#### 4. Available Frontend Scripts
```bash
yarn dev        # Start development server with HMR
yarn build      # Production build
yarn preview    # Preview production build locally
yarn lint       # Run ESLint
yarn format     # Format code with Prettier
```

### Production Deployment

#### Using Docker Compose (Recommended)
```bash
# Configure environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit both .env files with production values

# Build and deploy all services
make deploy

# The application will be available on port 3000
```

## 🔧 Configuration

### Required API Keys

1. **Google Maps API Key**
   - Enable: Maps JavaScript API, Places API, Geocoding API
   - Create separate keys for frontend and backend
   - Restrict frontend key by HTTP referrer
   - Restrict backend key by IP address

2. **OpenRouter API Key**
   - Sign up at [OpenRouter](https://openrouter.ai)
   - Add credits to your account
   - Copy your API key

3. **Sentry DSN** (Optional but recommended)
   - Create projects for frontend and backend
   - Enable performance monitoring
   - Copy DSN from project settings

4. **Supabase Configuration**
   - Create a project at [Supabase](https://supabase.com)
   - Navigate to **Settings → API** to find your keys:
     - **Project URL**: `https://your-project.supabase.co`
     - **Publishable Key** (anon key): `sb_publishable_xxx` - for frontend
     - **Secret Key** (service_role): `sb_secret_xxx` - for backend only
   - The backend uses JWKS endpoint for JWT verification: `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`

### Database Setup (Supabase)

Run the database migration in Supabase Dashboard:

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `backend/migrations/schema.sql`
4. Execute the SQL

The schema file is idempotent (can be run multiple times safely) and includes:
- `locations` - Street view location data with AI descriptions
- `exploration_preferences` - User exploration preferences by session
- `favorites` - User favorites (requires authentication)
- `exploration_history` - User exploration history (requires authentication)
- Row Level Security (RLS) policies for data protection

#### Schema Overview
```
┌─────────────────────────┐     ┌─────────────────────────┐
│       locations         │     │  exploration_preferences │
│  - pano_id (PK)         │     │  - session_id (PK)      │
│  - latitude/longitude   │     │  - interest             │
│  - address, country     │     │  - regions (JSONB)      │
│  - ai_description_*     │     │  - created_at           │
└─────────────────────────┘     └─────────────────────────┘
           │
           │ FK (pano_id)
           ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│       favorites         │     │   exploration_history    │
│  - id (PK)              │     │  - id (PK)              │
│  - user_id (UUID)       │     │  - user_id (UUID)       │
│  - pano_id (FK)         │     │  - pano_id (FK)         │
│  - created_at           │     │  - viewed_at            │
└─────────────────────────┘     └─────────────────────────┘
```

#### RLS Policies
- **Service Role**: Full access to all tables (backend operations)
- **Authenticated Users**: Can only access their own favorites and history
- **Anonymous Users**: Blocked from all tables (must use backend API)


## 🏗️ Architecture

### System Overview
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│    Nginx    │────▶│   Backend   │
│   (React)   │     │   (Proxy)   │     │    (Go)     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │                                       ▼
       │            ┌─────────────┐     ┌─────────────┐
       │            │    Redis    │     │  External   │
       │            │   (Cache)   │     │    APIs     │
       │            └─────────────┘     └─────────────┘
       │                                       │
       ▼                                       ▼
┌─────────────────────────────────────────────────────┐
│                     Supabase                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │    Auth     │  │  PostgreSQL │  │    JWKS     │ │
│  │   (OAuth)   │  │  (Database) │  │  (JWT验证)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Tech Stack

#### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 7.1 (fast HMR, optimized builds)
- **State Management**: Zustand with devtools
- **Maps**: Google Maps JavaScript API
- **Internationalization**: i18next with localStorage caching
- **Styling**: CSS Modules + Responsive Design
- **Monitoring**: Sentry (lazy loaded)

#### Backend
- **Language**: Go 1.22
- **Framework**: Gin Web Framework
- **Caching**: Redis 7.2 with TTL-based expiration
- **AI Integration**: OpenRouter API (GPT-4o)
- **Geographic Processing**: Custom GeoJSON algorithms with orb library
- **Monitoring**: Sentry with performance tracking

#### Infrastructure
- **Containerization**: Docker & Docker Compose (multi-stage builds)
- **Reverse Proxy**: Nginx with gzip, security headers, static caching
- **Monitoring**: Sentry for errors and performance
- **Database & Auth**: Supabase (PostgreSQL + Auth + JWKS)

## 📁 Project Structure

```
├── frontend/               # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── store/         # Zustand state management
│   │   ├── services/      # API client and external services
│   │   ├── utils/         # Utility functions
│   │   └── styles/        # CSS modules
│   └── public/locales/    # i18n translations (en/zh)
├── backend/               # Go backend server
│   ├── cmd/server/        # Application entry point
│   ├── internal/
│   │   ├── api/           # HTTP handlers and routes
│   │   ├── services/      # Business logic
│   │   ├── repositories/  # Data access layer
│   │   ├── models/        # Data structures
│   │   ├── utils/         # Geographic algorithms
│   │   └── config/        # Configuration management
│   └── data/maps/         # GeoJSON world polygons
├── nginx/                 # Nginx configuration
├── redis/                 # Redis configuration
└── docker-compose.yml     # Container orchestration
```

## ⚙️ Environment Variables

### Backend (`backend/.env`)
```bash
# Server
SERVER_ADDRESS=:8080
REDIS_ADDRESS=localhost:6379

# Supabase (Required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_your_key_here

# API Keys
AI_API_KEY=your_openrouter_key
GOOGLE_API_KEY=your_google_maps_key
GOOGLE_MAPS_MAP_ID=your_map_id

# Sentry (Optional)
SENTRY_DSN=your_sentry_dsn
SENTRY_ENABLED=true
SENTRY_SAMPLE_RATE=1.0

# Feature Flags
ENABLE_AI=true
ENABLE_GOOGLE_API=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

### Frontend (`frontend/.env`)
```bash
# Backend API
VITE_API_BASE_URL=http://localhost:8080

# Supabase (Required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_your_key_here

# Google Maps
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
VITE_GOOGLE_MAPS_MAP_ID=your_map_id

# Sentry (Optional)
VITE_SENTRY_DSN=your_sentry_dsn
VITE_SENTRY_ENVIRONMENT=development
VITE_VERSION=1.0.0
```

## 📄 License

MIT
