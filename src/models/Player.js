import mongoose from 'mongoose';

const careerStatsSchema = new mongoose.Schema(
  {
    PTS: { type: Number, default: 0, min: 0 },
    REB: { type: Number, default: 0, min: 0 },
    AST: { type: Number, default: 0, min: 0 },
    STL: { type: Number, default: 0, min: 0 },
    BLK: { type: Number, default: 0, min: 0 },
    TOV: { type: Number, default: 0, min: 0 },
    MIN: { type: Number, default: 0, min: 0 },
    FG: { type: Number, default: 0, min: 0 },
    FGA: { type: Number, default: 0, min: 0 },
    FG3: { type: Number, default: 0, min: 0 },
    FG3A: { type: Number, default: 0, min: 0 },
    FT: { type: Number, default: 0, min: 0 },
    FTA: { type: Number, default: 0, min: 0 },
    OREB: { type: Number, default: 0, min: 0 },
    DREB: { type: Number, default: 0, min: 0 },
    PF: { type: Number, default: 0, min: 0 },
    PLUS_MINUS: { type: Number, default: 0 },
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
    appliedGameIds: { type: [String], default: [], select: false },
  },
  { timestamps: true, versionKey: false },
);

playerSchema.index({ playerId: 1 }, { unique: true });

export default mongoose.model('Player', playerSchema);
