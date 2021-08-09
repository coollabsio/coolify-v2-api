import fp from 'fastify-plugin';
import jwt from 'fastify-jwt';
import type { FastifyPluginAsync } from 'fastify';
import User from '$models/User';

const plugin: FastifyPluginAsync = async (fastify, options) => {
  fastify.register(jwt, {
    secret: fastify.config.JWT_SIGN_KEY,
  });
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
      // const found = await User.findOne({ uid: verify.jti })
    } catch (err) {
      console.log(err)
      throw { status: 401 };
    }
  });
};

export default fp(plugin);
