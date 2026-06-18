# syntax=docker/dockerfile:1
# Single-image deploy for the YadSarah demo: the ASP.NET API also serves the built
# React SPA from wwwroot (same-origin → no CORS/SignalR cross-origin headaches).
# Build context = repo root. Used by Render (Docker runtime).

# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:22-alpine AS client
WORKDIR /client
COPY src/Client/package.json src/Client/package-lock.json ./
RUN npm ci
COPY src/Client/ ./
# VITE_API_URL is intentionally unset → client uses same-origin /api and /hubs.
RUN npm run build
# output: /client/dist

# ── Stage 2: build & publish the .NET API ────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /src
COPY src/Server/ ./
RUN dotnet publish YadSarah.Api/YadSarah.Api.csproj -c Release -o /publish /p:UseAppHost=false

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
# tzdata: DemoDataService/scheduling resolve "Asia/Jerusalem" on Linux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /publish ./
COPY --from=client /client/dist ./wwwroot
ENV ASPNETCORE_ENVIRONMENT=Production
# Listen on the platform-provided $PORT (Render injects it), default 10000 locally.
EXPOSE 10000
ENTRYPOINT ["sh", "-c", "ASPNETCORE_URLS=http://+:${PORT:-10000} dotnet YadSarah.Api.dll"]
