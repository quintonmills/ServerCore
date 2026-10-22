# Deploying ScoreKings Server Core

This service can be deployed from its Dockerfile to Render, Railway, Fly.io, or another container host. It requires Node.js 22+, MongoDB Atlas, and an OpenAI API key for flyer generation.

## 1. Prepare MongoDB Atlas

1. Create an Atlas cluster and a database user with read/write access to the ScoreKings database.
2. In **Network Access**, allow connections from your hosting provider. Prefer the provider's static outbound IP addresses. If the host has dynamic outbound IPs, Atlas may require `0.0.0.0/0`; use a strong, unique database password and restrict database-user permissions.
3. Copy the Atlas connection string. Replace its username/password placeholders and include the database name, for example:

   ```text
   mongodb+srv://<username>:<password>@<cluster-host>/scorekings?retryWrites=true&w=majority
   ```

## 2. Deploy the GitHub repository

1. Push the `server-core` repository to GitHub.
2. In Render, create a **Web Service** from the repository and select **Docker** as the runtime. For Railway, create a project from the GitHub repository and select its Dockerfile builder. For Fly.io, deploy the repository using its Dockerfile.
3. Set the service's health-check path to `/api/health` if the host provides a health-check setting.
4. Configure the environment variables below in the host dashboard. Do not commit production credentials or put them in Docker build arguments.
5. Deploy the service and wait for a successful MongoDB connection and a healthy deployment.

The Docker image uses Node.js 22 on Debian Bookworm, installs locked production dependencies with `npm ci`, and runs as the unprivileged `node` user. The Docker build installs dependencies inside the Linux container, rather than copying host `node_modules`.

## 3. Configure environment variables

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string for the `scorekings` database |
| `OPENAI_API_KEY` | Server-side OpenAI API key used for image generation |
| `CORS_ORIGIN` | Comma-separated exact origins allowed to call the API, e.g. `https://scorekings.example.com,https://admin.example.com` |
| `PUBLIC_BASE_URL` | The public API origin, e.g. `https://scorekings-api.onrender.com` |
| `PORT` | Use the host-provided value if required; the app defaults to `5000` locally |

The service listens on `process.env.PORT`. Do not set `PUBLIC_BASE_URL` to the frontend URL; it must be the backend's public origin because generated graphic URLs are served by this API. `CORS_ORIGIN` must contain the frontend's exact browser origin (scheme and hostname, and any non-default port), without a trailing path. For an iPad app using a WebView, configure the origin that the WebView actually sends. Do not use `*` in production unless the API is intentionally public to any browser origin.

## 4. Verify the deployment

Replace the example hostname below with the deployed service URL:

```sh
curl --fail https://scorekings-api.onrender.com/api/health
```

Expected response:

```json
{"status":"ok"}
```

To verify game finalization, send a valid JSON payload to `POST /api/games/finalize`. It must include a player photo for each selected scorer and a logo for each of their teams. Images must be valid PNG, JPEG, or WebP data URLs no larger than 5 MB each; the complete payload must be at most 14 MB. The request also calls OpenAI, so configure `OPENAI_API_KEY` and ensure the account has access to `gpt-image-1`.

Example request shape (replace each image placeholder with a real base64 data URL):

```json
{
  "gameId": "pilot-game-001",
  "location": "Gym Name",
  "teamA": {
    "name": "Home",
    "score": 24,
    "logo": "data:image/png;base64,<base64-encoded-team-logo>"
  },
  "teamB": {
    "name": "Away",
    "score": 18,
    "logo": "data:image/png;base64,<base64-encoded-team-logo>"
  },
  "players": [
    {
      "id": "player-001",
      "team": "Team A",
      "jersey": "3",
      "name": "Player Name",
      "pts": 14,
      "reb": 5,
      "ast": 3,
      "stl": 1,
      "blk": 0,
      "to": 2,
      "photo": "data:image/jpeg;base64,<base64-encoded-player-photo>"
    }
  ]
}
```

Use `curl --request POST "$PUBLIC_BASE_URL/api/games/finalize" --header 'Content-Type: application/json' --data-binary @payload.json` after saving a complete request with real image data URLs to `payload.json`. A successful response includes generated flyer URLs under `graphics[].publicUrl`. Open one of those URLs to confirm the generated JPEG is served by `/output/`.

## Generated JPEG storage

The service creates `output/` on app startup and serves generated JPEGs from `/output/`. This is suitable for a small, single-instance MVP pilot, but container filesystems are generally ephemeral: generated images may disappear after a restart, redeploy, or instance replacement. Avoid multiple instances with local-only output, since a later request can be routed to an instance that does not have the image.

For durable flyers or horizontal scaling, store JPEGs in S3-compatible object storage (for example AWS S3, Cloudflare R2, or a managed bucket) and return stable public or signed URLs. A persistent host volume mounted at `/app/output` can be an interim single-instance option when supported by the provider.
