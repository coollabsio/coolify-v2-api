import fp from 'fastify-plugin';
import jwt from 'fastify-jwt';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      JWT_SIGN_KEY: string;
    };
  }
}

const plugin: FastifyPluginAsync = async (fastify, options) => {
  fastify.register(jwt, {
    secret: fastify.config.JWT_SIGN_KEY,
  });
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      console.log('onRequest')
      await request.jwtVerify();
      const found = true;
      if (found) {
        return true;
      } else {
        throw new Error('User not found');
      }
    } catch (err) {
      throw { status: 401 };
    }
  });
};

export default plugin;
