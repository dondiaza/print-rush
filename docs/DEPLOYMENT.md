# Deployment

## Frontend

Vercel ejecuta desde la raíz del monorepo con `vercel.json`. El build compila los paquetes y después
Next.js.

### El pipeline cambió al añadir el Character Studio

Hasta entonces la app era `output: "export"` — un export estático puro — y se desplegaba **prebuilt**:
`npm run build:vercel` empaquetaba `apps/web/out` con la Build Output API y `vercel deploy --prebuilt`
subía el resultado.

Eso ya no es posible. El Character Studio necesita rutas API para hablar con Postgres y con el
almacenamiento de objetos, y **un export estático no puede alojar route handlers**. Al quitar
`output: "export"` la app pasa a tener funciones, que el empaquetado prebuilt de este proyecto no
sabía expresar.

El deploy actual:

```bash
set -a; . "$HOME/Documents/Proyectos Antigravity/.env.global.local"; set +a
# Copia sin .git: los metadatos de git disparan el bloqueo por autoría documentado en CLAUDE.md
npx vercel deploy --prod --yes --token "$VERCEL_TOKEN" --scope pamplings-projects
```

Sin `--prebuilt`: se suben las fuentes y **construye la nube de Vercel**, que es lo que ejecuta el
`buildCommand` de `vercel.json` y genera las funciones. `npm run build:vercel` sigue existiendo como
verificación local del build; ya no empaqueta nada.

Lo que **no** cambia: el juego sigue siendo estático y servido por CDN. Sólo la página de personajes
y `/api/characters/*` son dinámicas.

### Variables de entorno

El proyecto de Vercel ya tiene conectados un Postgres de Neon (`DATABASE_URL`) y un blob store
privado (`BLOB_READ_WRITE_TOKEN`). Se añadió `CHARACTER_STUDIO_KEY`, que es la clave que protege el
estudio; su valor está en `.env.global.local` y en el panel de Vercel, y no se imprime en ningún log.
Para trabajar en local: `npx vercel env pull apps/web/.env.local` desde la raíz del repo.

## Game server

Construir `apps/game-server/Dockerfile` en un servicio Node persistente con soporte WebSocket:

```bash
docker build -f apps/game-server/Dockerfile -t print-rush-server .
docker run -p 2567:2567 print-rush-server
```

Configurar health check `/health` y una región europea. PostgreSQL y Redis se añadirán como servicios administrados; sus URLs nunca se inyectan en variables `NEXT_PUBLIC_*`.
