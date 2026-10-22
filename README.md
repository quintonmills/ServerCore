# ScoreKings Server Core

Express API for saving finalized ScoreKings basketball games in MongoDB and rendering shareable player stat cards.

## Requirements

- Node.js 22 or newer (an actively supported Node.js LTS release)
- npm
- MongoDB 7 or newer, running locally or reachable at a configured URI

## Install and configure

For a production deployment using Docker and MongoDB Atlas, see [DEPLOYMENT.md](./DEPLOYMENT.md).

```sh
npm install
cp .env.example .env
```

Set the values in `.env`:

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `5000` |
| `MONGODB_URI` | MongoDB connection string | Required |
| `CORS_ORIGIN` | Allowed browser origin | `*` if unset |
| `PUBLIC_BASE_URL` | Base URL used in returned graphic links | `http://localhost:<PORT>` |
| `OPENAI_API_KEY` | API key used to generate player portraits with OpenAI | Required for flyer generation |

For a local MongoDB instance using Docker:

```sh
docker run --name scorekings-mongo -p 27017:27017 -d mongo:8
```

The `.env.example` URI connects to that local instance. Start the API after MongoDB is available:

```sh
npm start
```

The server waits for a successful MongoDB connection before it starts accepting HTTP requests. A connection or configuration error is logged and exits with a non-zero status.

## Scripts

- `npm start` — start the API
- `npm run dev` — start with automatic restarts using nodemon
- `npm test` — run validation, player-selection, and route tests (no MongoDB required)

## API

### Health check

`GET /api/health` returns:

```json
{ "status": "ok" }
```

### Finalize a game

`POST /api/games/finalize` accepts JSON. The frontend-provided `gameId` is stored and returned unchanged; quarter, clock, and game date are not required.

```json
{
  "gameId": "game-101",
  "location": "Marietta Rec League",
  "teamA": {
    "name": "Red Team",
    "score": 24,
    "logo": "data:image/png;base64,<base64-encoded-team-logo>"
  },
  "teamB": {
    "name": "Blue Team",
    "score": 18,
    "logo": "data:image/png;base64,<base64-encoded-team-logo>"
  },
  "players": [
    {
      "id": "p1",
      "team": "Team A",
      "jersey": "3",
      "name": "Marcus",
      "pts": 14,
      "reb": 5,
      "ast": 3,
      "stl": 1,
      "blk": 0,
      "to": 2,
      "photo": "data:image/jpeg;base64,<base64-encoded-player-photo>"
    }
  ],
  "imageGeneration": {
    "prompt": "Add a subtle arena spotlight",
    "size": "1024x1536",
    "quality": "high"
  }
}
```

`photo` is the player's reference image; `logo` is the reference logo for its team. Supply PNG, JPEG, or WebP image data URLs, each no larger than 5 MB. A photo is required for each selected scorer (up to three players with at least one point), and a logo is required for each selected player's team. `imageGeneration` is optional: `prompt` adds art direction, `size` accepts `1024x1024`, `1024x1536`, `1536x1024`, or `auto`, and `quality` accepts `low`, `medium`, `high`, or `auto`. Defaults are `1024x1536` and `high`. Uploaded player photos, team logos, and image-generation settings are saved with the game in MongoDB; the API limits the complete stored game payload to 14 MB to stay safely below MongoDB's 16 MB document limit. Image data is omitted from the response to keep it small.

The API returns `200 OK` with the upserted game and generated cards. The `game` includes Mongoose timestamps, and each graphic has its player's ID and name, its generated file path, and a public URL:

```json
{
  "game": {
    "gameId": "game-101",
    "location": "Marietta Rec League",
    "teamA": { "name": "Red Team", "score": 24 },
    "teamB": { "name": "Blue Team", "score": 18 },
    "players": [
      {
        "id": "p1",
        "team": "Team A",
        "jersey": "3",
        "name": "Marcus",
        "pts": 14,
        "reb": 5,
        "ast": 3,
        "stl": 1,
        "blk": 0,
        "to": 2
      }
    ],
    "createdAt": "2026-10-21T12:00:00.000Z",
    "updatedAt": "2026-10-21T12:00:00.000Z"
  },
  "graphics": [
    {
      "playerId": "p1",
      "playerName": "Marcus",
      "filePath": "/path/to/server-core/output/game-101-p1-<unique-id>.jpg",
      "publicUrl": "http://localhost:5000/output/game-101-p1-<unique-id>.jpg"
    }
  ]
}
```

Every valid finalization uses `gameId` as an upsert key: sending it again updates that game rather than creating a duplicate, and regenerates its cards. A unique MongoDB index enforces this behavior. The response is `200 OK` for both first and repeated finalizations.

Input is validated before persistence or rendering. Invalid fields, unexpected keys (including filesystem paths), unsupported player teams, non-numeric or negative scores/stats, and malformed JSON return a `400` JSON error. For example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid game payload",
    "details": ["players[0].team must be \"Team A\" or \"Team B\""]
  }
}
```

If persistence or rendering fails, the API returns an error and never reports success. Persistence happens before rendering; therefore, on a rendering failure the saved game remains, and a repeated request can retry generation. Files already created during that failed request are removed where possible; cleanup failures are logged. Older cards from earlier successful requests are not automatically pruned.

## Stat cards

For each selected scorer, the API sends the player photo, their team's logo, player identity, stats, and optional art direction to OpenAI's `gpt-image-1` image-edit endpoint to generate a portrait. The logo and exact player statistics are then composited into the existing dark-mode 1080 × 1350 Canvas flyer template, so generated imagery cannot alter the displayed logo or stat values. Uploaded reference images and generation settings are saved with the game in MongoDB; generated JPEGs are written to `output/` (ignored by git) and served at `/output/<filename>`. Set `PUBLIC_BASE_URL` to the externally reachable API origin when links should point somewhere other than the local default.

Cards are generated for at most three players with at least one point. Selection is centralized in `src/services/selectPlayersForCards.js` and ranks players by points, then rebounds, then assists, descending. Ties after assists retain their incoming player order.

## Tests

```sh
npm test
```

The route tests inject a lightweight persistence implementation and a graphics stub, so they do not connect to MongoDB or write generated images.
