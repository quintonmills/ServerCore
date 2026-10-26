import mongoose from 'mongoose';

const imageGenerationSchema = new mongoose.Schema(
  {
    prompt: { type: String, maxlength: 1000 },
    size: { type: String, enum: ['1024x1024', '1024x1536', '1536x1024', 'auto'] },
    quality: { type: String, enum: ['low', 'medium', 'high', 'auto'] },
  },
  { _id: false },
);

const teamSchema = new mongoose.Schema(
  {
    teamId: { type: String, maxlength: 100 },
    name: { type: String, required: true, maxlength: 200 },
    score: { type: Number, required: true, min: 0 },
    logo: { type: String, maxlength: 7 * 1024 * 1024 },
    logoUrl: { type: String, maxlength: 2048 },
  },
  { _id: false },
);

const gameTeamSchema = new mongoose.Schema(
  {
    teamId: { type: String, maxlength: 100 },
    name: { type: String, required: true, maxlength: 200 },
    score: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const boxScoreSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, maxlength: 100 },
    firstName: { type: String, maxlength: 100 },
    lastName: { type: String, maxlength: 100 },
    name: { type: String, maxlength: 200 },
    jersey: { type: String, maxlength: 10 },
    teamId: { type: String, maxlength: 100 },
    PTS: { type: Number, min: 0, default: 0 },
    REB: { type: Number, min: 0, default: 0 },
    AST: { type: Number, min: 0, default: 0 },
    STL: { type: Number, min: 0, default: 0 },
    BLK: { type: Number, min: 0, default: 0 },
    TOV: { type: Number, min: 0, default: 0 },
    MIN: { type: Number, min: 0 },
    FG: { type: Number, min: 0 },
    FGA: { type: Number, min: 0 },
    FG3: { type: Number, min: 0 },
    FG3A: { type: Number, min: 0 },
    FT: { type: Number, min: 0 },
    FTA: { type: Number, min: 0 },
    OREB: { type: Number, min: 0 },
    DREB: { type: Number, min: 0 },
    PF: { type: Number, min: 0 },
    PLUS_MINUS: { type: Number },
    FGM: { type: Number, min: 0 },
    FG3M: { type: Number, min: 0 },
    FTM: { type: Number, min: 0 },
  },
  { _id: false, strict: false },
);

const playerSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 100 },
    team: { type: String, required: true, enum: ['Team A', 'Team B'] },
    jersey: { type: String, required: true, maxlength: 10 },
    name: { type: String, required: true, maxlength: 200 },
    pts: { type: Number, required: true, min: 0 },
    reb: { type: Number, required: true, min: 0 },
    ast: { type: Number, required: true, min: 0 },
    stl: { type: Number, required: true, min: 0 },
    blk: { type: Number, required: true, min: 0 },
    to: { type: Number, required: true, min: 0 },
    photo: { type: String, maxlength: 7 * 1024 * 1024 },
    photos: {
      type: [{ type: String, maxlength: 7 * 1024 * 1024 }],
      default: undefined,
      validate: (images) => images.length >= 1 && images.length <= 3,
    },
  },
  { _id: false },
);

const gameSchema = new mongoose.Schema(
  {
    gameId: { type: String, required: true, maxlength: 100 },
    location: { type: String, required: true, maxlength: 200 },
    status: { type: String, maxlength: 50, default: 'completed' },
    startedAt: { type: Date },
    completedAt: { type: Date },
    teamA: { type: teamSchema, required: true },
    teamB: { type: teamSchema, required: true },
    teams: {
      home: { type: gameTeamSchema },
      away: { type: gameTeamSchema },
    },
    players: { type: [playerSchema], required: true },
    boxScore: { type: [boxScoreSchema], default: [] },
    events: { type: [mongoose.Schema.Types.Mixed], default: [] },
    generatedMedia: {
      type: [
        new mongoose.Schema(
          {
            type: { type: String, required: true, enum: ['flyer'] },
            playerId: { type: String, required: true, maxlength: 100 },
            publicUrl: { type: String, required: true, maxlength: 2048 },
            downloadUrl: { type: String, required: true, maxlength: 2048 },
            generatedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    imageGeneration: { type: imageGenerationSchema },
  },
  { timestamps: true, versionKey: false },
);

gameSchema.index({ gameId: 1 }, { unique: true });

export default mongoose.model('Game', gameSchema);
