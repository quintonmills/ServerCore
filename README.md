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
| `OPENAI_IMAGE_MODEL` | OpenAI image-edit model | `gpt-image-2.5-sunburst` |

For a MongoDB Atlas deployment, set `MONGODB_URI` to the Atlas connection string provided for your cluster. Keep credentials in the environment file or deployment secret store, not in source control. For a local MongoDB instance using Docker:

```sh
docker run --name scorekings-mongo -p 27017:27017 -d mongo:8
```

For local development, set `MONGODB_URI=mongodb://127.0.0.1:27017/scorekings`. Start the API after MongoDB is available:

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
    "teamId": "red-team",
    "name": "Red Team",
    "score": 24,
    "logo": "data:image/png;base64,<base64-encoded-team-logo>"
  },
  "teamB": {
    "teamId": "blue-team",
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
      "photos": [
        "data:image/jpeg;base64,<base64-encoded-player-photo-1>",
        "data:image/jpeg;base64,<base64-encoded-player-photo-2>",
        "data:image/jpeg;base64,<base64-encoded-player-photo-3>"
      ]
    }
  ],
  "status": "COMPLETED",
  "startedAt": "2026-10-21T11:00:00.000Z",
  "completedAt": "2026-10-21T12:00:00.000Z",
  "boxScore": [
    {
      "playerId": "p1",
      "firstName": "Marcus",
      "lastName": "Example",
      "teamId": "red-team",
      "jersey": "3",
      "PTS": 14,
      "REB": 5,
      "AST": 3,
      "STL": 1,
      "BLK": 0,
      "TOV": 2
    }
  ],
  "events": [
    {
      "type": "shot_made",
      "period": 1,
      "clock": "10:32",
      "playerId": "p1",
      "teamId": "red-team",
      "points": 2
    }
  ],
  "imageGeneration": {
    "prompt": "Add a subtle arena spotlight",
    "size": "1024x1536",
    "quality": "high"
  }
}
```

The frontend may send one to three `photos` for the top-ranked scorer and may omit player photos or team `logo` assets. Supply PNG, JPEG, or WebP image data URLs, each no larger than 5 MB. When the selected player has one to three photos and their team has a logo, the API generates a flyer; otherwise it still persists the game and returns an empty `graphics` array. The existing singular `photo` field remains accepted for older clients. `boxScore` is optional; when omitted, player stats are used to build it. `events` is an optional array of play-by-play objects, and box-score entries can provide uppercase or lowercase stat keys. `teamId` values identify corresponding Team and Player records. `imageGeneration` is optional: `prompt` adds compatible art direction, `size` accepts `1024x1024`, `1024x1536`, `1536x1024`, or `auto`, and `quality` accepts `low`, `medium`, `high`, or `auto`. Defaults are `1024x1536` and `high`. Uploaded player photos, team logos, and image-generation settings are saved with the game in MongoDB; the API limits the complete stored game payload to 14 MB to stay safely below MongoDB's 16 MB document limit. Image data is omitted from the response to keep it small.

The API returns `200 OK` with the upserted game and exactly one generated flyer. The `game` includes Mongoose timestamps, and the graphic has its player's ID and name, its generated file path, a public preview URL, and a stable download URL:

```json
{
  "game": {
    "_id": "671000000000000000000001",
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
    "teams": {
      "home": { "teamId": "red-team", "name": "Red Team", "score": 24 },
      "away": { "teamId": "blue-team", "name": "Blue Team", "score": 18 }
    },
    "status": "completed",
    "boxScore": [
      { "playerId": "p1", "PTS": 14, "REB": 5, "AST": 3 }
    ],
    "events": [
      { "type": "shot_made", "period": 1, "playerId": "p1", "points": 2 }
    ],
    "generatedMedia": [
      {
        "type": "flyer",
        "playerId": "p1",
        "publicUrl": "https://scorekings-api.example.com/output/game-101-p1-<unique-id>.jpg",
        "downloadUrl": "https://scorekings-api.example.com/api/games/flyers/game-101-p1-<unique-id>.jpg/download"
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
      "publicUrl": "https://scorekings-api.example.com/output/game-101-p1-<unique-id>.jpg",
      "downloadUrl": "https://scorekings-api.example.com/api/games/flyers/game-101-p1-<unique-id>.jpg/download"
    }
  ]
}
```

`publicUrl` previews the JPEG. `downloadUrl` is a QR-code-friendly HTTPS endpoint that serves the same JPEG with `Content-Disposition: attachment`; it does not expire while the flyer remains in storage. Configure `PUBLIC_BASE_URL` as the externally reachable HTTPS API origin and use durable storage for `output/` so downloads remain available after restarts and redeployments. If no player has at least one point, or required flyer assets are missing, finalization still saves the game and returns an empty `graphics` array.

Every valid finalization uses `gameId` as an upsert key: sending it again updates that game rather than creating a duplicate, and regenerates its cards. A unique MongoDB index enforces this behavior. Career totals use atomic `$inc` updates and track applied game IDs so retries do not count a game's box score twice. Team and player records are upserted when team/player IDs are supplied. The response is `200 OK` for both first and repeated finalizations.

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

For the top-ranked eligible scorer, when one to three player photos and their team logo are available, the API sends the bundled `assets/flyer-style-reference.png`, the player photos, team logo, player identity, points total, and optional art direction to OpenAI's image-edit endpoint using `OPENAI_IMAGE_MODEL` (defaults to `gpt-image-2.5-sunburst`). Ensure the API organization is verified and the configured key has access to the selected model. The template is used only for broad visual direction (gritty monochrome collage, textured paper, bold type, and a team-color accent); the prompt asks for an original composition and excludes the reference's wording, pictured subject, logos, signature, and distinctive arrangement. Player photos provide views of the same athlete, while name, jersey, team, and points are the only player facts requested in the generated copy. Ranking remains points, rebounds, then assists, descending; ties retain incoming player order. OpenAI generates the complete flyer image, which the backend saves directly without local image composition. Uploaded player photos and team logos are saved with the game in MongoDB; generated JPEGs are written to `output/` (ignored by git) and served at `/output/<filename>` for preview and `/api/games/flyers/<filename>/download` as an attachment. Flyer URLs are also appended to the game's `generatedMedia` array after image generation succeeds. Set `FLYER_STYLE_REFERENCE_PATH` to use a different PNG/JPEG/WebP style reference at runtime, and set `PUBLIC_BASE_URL` to the externally reachable HTTPS API origin.

Because the full flyer typography and logo placement are generated by an image model, text, statistics, and logos may not render perfectly every time. Review generated flyers before sharing them when exact typography or score accuracy is essential.

Flyers are generated for only the highest-ranked player with at least one point. Selection is centralized in `src/services/selectPlayersForCards.js` and ranks players by points, then rebounds, then assists, descending. Ties after assists retain their incoming player order.

## Tests

```sh
npm test
```

The route tests inject a lightweight persistence implementation and a graphics stub, so they do not connect to MongoDB or write generated images.
