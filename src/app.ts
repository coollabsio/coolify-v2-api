import type { FastifyPluginAsync } from 'fastify';
import authentication from '$plugins/authentication';
import login from '$routes/v1/login';
import applications from '$routes/v1/applications';

import dashboard from '$routes/v1/dashboard';
import databases from '$routes/v1/databases';
import servers from '$routes/v1/servers';
import settings from '$routes/v1/settings';
import services from '$routes/v1/services';
import upgrade from '$routes/v1/upgrade';
import webhooks from '$routes/v1/webhooks';

const register: FastifyPluginAsync = async function (fastify) {
  fastify.register(async function (server) {
    // Private routes
    server.register(authentication);

  });
  // Public routes
  fastify.register(login);
  fastify.register(dashboard);
  fastify.register(applications);
  fastify.register(settings);
  fastify.register(databases);
  fastify.register(servers);
  fastify.register(services);
  fastify.register(upgrade);
  fastify.register(webhooks);
};
export default register;
