import mongoose from 'mongoose';

const imageGenerationSchema = new mongoose.Schema(
  {
    prompt: { type: String, maxlength: 1000 },
    size: { type: String, enum: ['1024x1024', '1024x1536', '1536x1024', 'auto'] },
    quality: { type: String, enum: ['low', 'medium', 'high', 'auto'] },
  },
  { _id: false },
);

const mediaTeamSchema = new mongoose.Schema(
  {
    logo: { type: String, maxlength: 7 * 1024 * 1024 },
    logoUrl: { type: String, maxlength: 2048 },
  },
  { _id: false },
);

const playByPlayEventSchema = new mongoose.Schema(
  {
    period: { type: mongoose.Schema.Types.Mixed },
    playerId: { type: String, maxlength: 100 },
    action: { type: String, maxlength: 100 },
    timestamp: { type: Date },
    resultingScore: {
      teamA: { type: Number, min: 0 },
      teamB: { type: Number, min: 0 },
    },
  },
  { strict: false },
);

const generatedMediaSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, maxlength: 100 },
    playerId: { type: String, maxlength: 100 },
    publicUrl: { type: String, required: true, maxlength: 2048 },
    downloadUrl: { type: String, required: true, maxlength: 2048 },
    generatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const playerMediaSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, maxlength: 100 },
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
    idempotencyKey: { type: String, maxlength: 100 },
    location: { type: String, required: true, maxlength: 200 },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'COMPLETED'],
      default: 'COMPLETED',
    },
    timestamps: {
      startedAt: { type: Date },
      completedAt: { type: Date },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    gameData: {
      teamName: { type: String, required: true, maxlength: 200 },
      players: { type: mongoose.Schema.Types.Mixed, required: true },
      events: { type: Map, of: playByPlayEventSchema, default: () => new Map() },
    },
    media: {
      team: { type: mediaTeamSchema, default: () => ({}) },
      teamA: { type: mediaTeamSchema, default: undefined },
      teamB: { type: mediaTeamSchema, default: undefined },
      players: { type: [playerMediaSchema], default: [] },
      generatedMedia: { type: [generatedMediaSchema], default: [] },
      imageGeneration: { type: imageGenerationSchema },
    },
    metadata: {
      testMode: { type: Boolean, default: false },
      verifiedForLicensing: { type: Boolean, default: false },
    },
  },
  { timestamps: false, versionKey: false },
);

gameSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export default mongoose.model('Game', gameSchema);
