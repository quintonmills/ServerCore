import mongoose from 'mongoose';

const careerStatsSchema = new mongoose.Schema(
  {
    pts: { type: Number, default: 0, min: 0 },
    reb: { type: Number, default: 0, min: 0 },
    ast: { type: Number, default: 0, min: 0 },
    stl: { type: Number, default: 0, min: 0 },
    blk: { type: Number, default: 0, min: 0 },
    to: { type: Number, default: 0, min: 0 },
    gamesPlayed: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const playerSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true, maxlength: 100 },
    firstName: { type: String, required: true, maxlength: 100 },
    lastName: { type: String, maxlength: 100 },
    jersey: { type: String, maxlength: 10 },
    teamId: { type: String, maxlength: 100 },
    careerStats: { type: careerStatsSchema, default: () => ({}) },
  },
  { timestamps: true, versionKey: false },
);

playerSchema.index({ playerId: 1 }, { unique: true });

export default mongoose.model('Player', playerSchema);
