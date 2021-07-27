import type { FastifyPluginAsync } from 'fastify';
import Settings from '$models/Settings';
const applicationName = 'coolify';

const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/settings', async () => {
    try {
      const settings = await Settings.findOne({ applicationName }).select('-_id -__v');
      const payload = {
        applicationName,
        allowRegistration: false,
        ...settings._doc,
      };
      return payload;
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error);
    }
  });
  fastify.post('/', async (request, reply) => {
    try {
      const settings = await Settings.findOneAndUpdate(
        { applicationName },
        // @ts-ignore
        { applicationName, ...request.body },
        { upsert: true, new: true },
      ).select('-_id -__v');
      return {
        ...settings._doc,
      };
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error);
    }
  });
};

export default route;
