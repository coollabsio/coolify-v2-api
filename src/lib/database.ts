import mongoose from 'mongoose';

async function connectMongoDB() {
  // TODO: Save configurations on start?
  const { MONGODB_USER, MONGODB_PASSWORD, MONGODB_HOST, MONGODB_PORT, MONGODB_DB } = process.env;
  try {
    if (process.env.NODE_ENV === 'production') {
      await mongoose.connect(
        `mongodb://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DB}?authSource=${MONGODB_DB}&readPreference=primary&ssl=false`,
        { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false },
      );
    } else {
      await mongoose.connect(
        'mongodb://supercooldbuser:developmentPassword4db@localhost:27017/coolify?&readPreference=primary&ssl=false',
        { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false },
      );
    }
    console.log('Connected to mongodb.');
  } catch (error) {
    console.log(error);
  }
}

export default connectMongoDB;
