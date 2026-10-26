import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema(
  {
    teamId: { type: String, required: true, maxlength: 100 },
    name: { type: String, required: true, maxlength: 200 },
    logoUrl: { type: String, maxlength: 2048 },
  },
  { timestamps: true, versionKey: false },
);

teamSchema.index({ teamId: 1 }, { unique: true });

export default mongoose.model('Team', teamSchema);
