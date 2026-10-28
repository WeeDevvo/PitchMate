# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy project files for caching restore layer
COPY Directory.Build.props ./
COPY backend/PitchMate.slnx backend/
COPY backend/src/PitchMate.Domain/PitchMate.Domain.csproj backend/src/PitchMate.Domain/
COPY backend/src/PitchMate.Application/PitchMate.Application.csproj backend/src/PitchMate.Application/
COPY backend/src/PitchMate.Infrastructure/PitchMate.Infrastructure.csproj backend/src/PitchMate.Infrastructure/
COPY backend/src/PitchMate.Api/PitchMate.Api.csproj backend/src/PitchMate.Api/

RUN dotnet restore backend/src/PitchMate.Api/PitchMate.Api.csproj

# Copy source tree
COPY packages/ packages/
COPY backend/ backend/

# Publish backend API (OpenAPI generation runs during build and writes to packages/api-client/openapi/v1.json)
RUN dotnet publish backend/src/PitchMate.Api/PitchMate.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:5243 \
    ASPNETCORE_ENVIRONMENT=Production

EXPOSE 5243

COPY --from=build /app/publish ./

USER $APP_UID

ENTRYPOINT ["dotnet", "PitchMate.Api.dll"]
