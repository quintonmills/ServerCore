import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 200 },
    score: { type: Number, required: true, min: 0 },
  },
  { _id: false },
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
  },
  { _id: false },
);

const gameSchema = new mongoose.Schema(
  {
    gameId: { type: String, required: true, maxlength: 100 },
    location: { type: String, required: true, maxlength: 200 },
    teamA: { type: teamSchema, required: true },
    teamB: { type: teamSchema, required: true },
    players: { type: [playerSchema], required: true },
  },
  { timestamps: true, versionKey: false },
);

gameSchema.index({ gameId: 1 }, { unique: true });

export default mongoose.model('Game', gameSchema);
