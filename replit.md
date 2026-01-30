# AI Model Aggregator

## Overview

This is an AI-powered conversation monitoring application that simulates real-time conversation analysis. Multiple AI models analyze incoming conversation streams and display pulsing light indicators showing how confident they are about contributing. Users click the pulsing lights to insert the AI's proposed response into the conversation.

### Key Features
- **Pulsing Light Orbs**: Each AI model displays a pulsing orb with intensity based on confidence (0-100% Value Score)
- **User-Initiated Responses**: Click the orb or "Click to Speak" button to trigger the AI's response
- **Three AI Personas**: Sales Advisor (green), Technical Expert (indigo), Meeting Coordinator (amber)
- **Real-Time Analysis**: AI models analyze conversations using gpt-4o-mini and determine when to contribute

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Build Tool**: Vite with path aliases (@/ for client/src, @shared/ for shared)

### Backend Architecture
- **Framework**: Express.js 5 with TypeScript
- **Runtime**: Node.js with tsx for TypeScript execution
- **API Pattern**: RESTful JSON API under /api prefix
- **AI Integration**: OpenAI SDK configured via Replit AI Integrations (custom base URL and API key from environment variables)

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: shared/schema.ts (shared between frontend and backend)
- **Migrations**: Drizzle Kit with migrations output to /migrations folder
- **Key Entities**:
  - `rooms`: Virtual conference rooms where conversations happen
  - `conversationEntries`: Text messages in a room (simulating transcribed audio)
  - `aiModels`: AI personas with trigger thresholds and personas
  - `modelAnalyses`: AI analysis results with confidence scores
  - `outboundCalls`: Triggered call records when AI decides to speak
  - `users`: Basic user authentication table

### Build Configuration
- **Development**: `npm run dev` - runs tsx with Vite dev server middleware
- **Production Build**: Custom build script using esbuild for server, Vite for client
- **Output**: Server bundles to dist/index.cjs, client to dist/public

## External Dependencies

### AI Services
- **OpenAI API**: Used for conversation analysis via Replit AI Integrations
  - Environment variables: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`
  - Supports text chat completions, text-to-speech, speech-to-text, and image generation

### Database
- **PostgreSQL**: Required for data persistence
  - Environment variable: `DATABASE_URL`
  - Connection pooling via node-postgres (pg)

### Replit Integrations
The project includes pre-built integration modules in `server/replit_integrations/`:
- **audio/**: Voice chat with PCM16 streaming, speech-to-text, text-to-speech
- **chat/**: Conversation storage and streaming chat completions
- **image/**: Image generation via gpt-image-1 model
- **batch/**: Rate-limited batch processing utilities with retry logic

### Client Audio Utilities
Located in `client/replit_integrations/audio/`:
- AudioWorklet for streaming PCM16 playback
- React hooks for voice recording and streaming responses