import mongoose from 'mongoose';
const { Schema } = mongoose;

const DatabaseSchema = new Schema({
  general: {
    deployId: { type: String, required: true },
    nickname: { type: String, required: true },
    workdir: { type: String, required: true },
    type: { type: String, required: true },
  },
  database: {
    image: { type: String, required: true },
    volume: { type: String, required: true },
    defaultDatabaseName: { type: String },
  },
  publish: {
    secrets: [
      {
        name: { type: String },
        value: { type: String },
      },
    ],
    usernames: [
      {
        name: { type: String },
        value: { type: String },
      },
    ],
  },
});

DatabaseSchema.set('timestamps', true);

export default mongoose.models['database'] || mongoose.model('database', DatabaseSchema);
