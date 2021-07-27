import fastify from 'fastify';
import fastifyEnv from 'fastify-env';
import app from './app';
import mongoose from 'mongoose';
import connectMongoDB from '$lib/database';
// import fastifyNow from 'fastify-now';
// import path from 'path';
// import authentication from '$plugins/authentication';
const PORT = Number(process.env.PORT) || 3001;

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      JWT_SIGN_KEY: string;
    };
  }
}
const server = fastify({ logger: true });
const requiredDotenvSchema = {
  type: 'object',
  required: ['JWT_SIGN_KEY'],
  properties: {
    JWT_SIGN_KEY: {
      type: 'string',
    },
  },
};

server.register(fastifyEnv, {
  schema: requiredDotenvSchema,
  dotenv: true,
});

(async () => {
  if (mongoose.connection.readyState !== 1) await connectMongoDB();
})();

server.register(app, { prefix: '/v1' });
server.listen(PORT, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
