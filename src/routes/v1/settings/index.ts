import type { FastifyPluginAsync } from 'fastify';
import Settings from '$models/Settings';
const applicationName = 'coolify';

interface Settings {
  allowRegistration: boolean;
  sendErrors: boolean;

}
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
  fastify.post<{ Body: Settings }>('/settings', async (request, reply) => {
    const { allowRegistration, sendErrors } = request.body
    try {
      const settings = await Settings.findOneAndUpdate(
        { applicationName },
        // @ts-ignore
        { applicationName, allowRegistration, sendErrors },
        { upsert: true, new: true },
      ).select('-_id -__v -createdAt -updatedAt -applicationName');

      return {
        ...settings._doc,
      };
    } catch (error) {
      console.log(error)
      // await saveServerLog(error);
      throw new Error(error);
    }
  });
};

export default route;
