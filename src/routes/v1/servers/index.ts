import type { FastifyPluginAsync } from 'fastify';
import { execShellAsync } from '$lib/common';
import * as systeminformation from 'systeminformation';

const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/servers', async () => {
    try {
      const df = await execShellAsync(`docker system df  --format '{{ json . }}'`);
      const dockerReclaimable = df
        .split('\n')
        .filter((n) => n)
        .map((s) => JSON.parse(s));

      return {
        status: 200,
        body: {
          hostname: await (await systeminformation.osInfo()).hostname,
          filesystems: await (
            await systeminformation.fsSize()
          ).filter((fs) => !fs.fs.match('/dev/loop') || !fs.fs.match('/var/lib/docker/')),
          dockerReclaimable,
        },
      };
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error.message || error);
    }
  });
  fastify.post('/servers/cleanups/caches', async () => {
    try {
      const output = await execShellAsync('docker builder prune -af');
      return {
        message: 'OK',
        output: output
          .replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, '')
          .split('\n')
          .pop(),
      };
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error.message || error);
    }
  });
  fastify.post('/servers/cleanup/containers', async () => {
    try {
      const output = await execShellAsync('docker container prune -f');
      return {
        message: 'OK',
        output: output
          .replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, '')
          .split('\n')
          .pop(),
      };
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error.message || error);
    }
  });
  fastify.post('/servers/cleanup/images', async () => {
    try {
      const output = await execShellAsync('docker image prune -af');
      return {
        message: 'OK',
        output: output
          .replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, '')
          .split('\n')
          .pop(),
      };
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error.message || error);
    }
  });
  fastify.post('/servers/cleanup/volumes', async () => {
    try {
      const output = await execShellAsync('docker volume prune -f');
      return {
        message: 'OK',
        output: output
          .replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, '')
          .split('\n')
          .pop(),
      };
    } catch (error) {
      // await saveServerLog(error);
      throw new Error(error.message || error);
    }
  });
};

export default route;
