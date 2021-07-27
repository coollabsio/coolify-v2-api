import type { FastifyPluginAsync } from 'fastify';

const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/login/verify', async (request, reply) => {
    return 'hello';
  });
};

export default route;
