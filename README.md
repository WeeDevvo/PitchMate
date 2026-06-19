# PitchMate

A football app for organising fair, casual small-sided matches between friends — squads, availability/RSVP, auto-balanced teams (OpenSkill), live tracking, and player stats. Domain: pitch-mate.co.uk.

## Monorepo layout

```
backend/          .NET 10 solution (Clean Architecture: Domain → Application → Infrastructure → Api)
  src/            Domain · Application · Infrastructure · Api
  tests/          Domain.Tests · Application.Tests · Infrastructure.Tests
apps/
  web/            React + TypeScript + Vite (building now)
  mobile/         React Native + Expo (placeholder)
  watch/          SwiftUI watchOS (placeholder)
packages/
  api-client/     Typed TS client generated from the OpenAPI spec (placeholder)
docs/             Backlog, ADRs, local-dev guide (local only; git-ignored)
```

## Quick start

```powershell
# Database (Docker)
docker compose up -d

# Backend API
cd backend
dotnet tool restore
dotnet run --project src/PitchMate.Api

# Web (from repo root, npm workspaces)
npm install
npm run dev
```

Full commands, migrations, and troubleshooting are in `docs/local-dev.md`.

## Tech

.NET 10 Web API + EF Core 10 + Npgsql + PostgreSQL · React/TypeScript/Vite · OpenSkill ratings · Azure hosting. Architecture and product decisions live in `.kiro/steering/`.
