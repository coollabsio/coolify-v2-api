import fastify from 'fastify';
import fastifyEnv from 'fastify-env';
import app from './app';
import mongoose from 'mongoose';
import connectMongoDB from '$lib/database';
import fastifyCookie, { FastifyCookieOptions } from 'fastify-cookie'
import fastifyStatic from 'fastify-static'
import fastifyCors from 'fastify-cors'
import socketioServer from 'fastify-socket.io'
import path from 'path';

const PORT = Number(process.env.PORT) || 3001;

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      DOMAIN: string;
      JWT_SIGN_KEY: string;
      DOCKER_ENGINE: string;
      VITE_GITHUB_APP_CLIENTID: string;
      GITHUB_APP_CLIENT_SECRET: string;
    };
  }
}

const requiredDotenvSchema = {
  type: 'object',
  required: ['DOMAIN', 'JWT_SIGN_KEY', 'DOCKER_ENGINE', 'VITE_GITHUB_APP_CLIENTID', 'GITHUB_APP_CLIENT_SECRET'],
  properties: {
    DOMAIN: {
      type: 'string'
    },
    JWT_SIGN_KEY: {
      type: 'string',
    },
    DOCKER_ENGINE: {
      type: 'string',
    },
    VITE_GITHUB_APP_CLIENTID: {
      type: 'string',
    },
    GITHUB_APP_CLIENT_SECRET: {
      type: 'string',
    },
  },
};

const server = fastify({
  logger: {
    prettyPrint: {
      translateTime: true,
      ignore: 'pid,hostname,reqId,responseTime,req,res',
      messageFormat: '{msg} [id={reqId} {req.method} {req.url}]'
    }
  }
});
server.register(fastifyCors)
server.register(fastifyCookie, {
  secret: "my-secret",
} as FastifyCookieOptions)
console.log(path.join(__dirname, 'public'))
server.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),

})
server.register(socketioServer)
server.register(fastifyEnv, {
  schema: requiredDotenvSchema,
  dotenv: true
});

(async () => {
  if (mongoose.connection.readyState !== 1) await connectMongoDB();
})();

server.get('/', async () => {
  return 'OK'
});
server.register(app, { prefix: '/api/v1' });
server.ready(err => {
  if (err) throw err
  server.io.on('connect', (socket) => {
    socket.on('asd', (data) => {
      console.log(data)
    })
    console.info('Socket connected!', socket.id)
  })
})
server.listen(PORT, '0.0.0.0', (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
