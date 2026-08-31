# Deployment

## Frontend

Vercel ejecuta desde la raíz del monorepo con `vercel.json`. El build compila primero `game-core` y después Next.js.

## Game server

Construir `apps/game-server/Dockerfile` en un servicio Node persistente con soporte WebSocket:

```bash
docker build -f apps/game-server/Dockerfile -t print-rush-server .
docker run -p 2567:2567 print-rush-server
```

Configurar health check `/health` y una región europea. PostgreSQL y Redis se añadirán como servicios administrados; sus URLs nunca se inyectan en variables `NEXT_PUBLIC_*`.
