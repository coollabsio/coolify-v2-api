import type { FastifyPluginAsync } from 'fastify';
import { execShellAsync } from '$lib/common';

const route: FastifyPluginAsync = async (fastify) => {
  fastify.get('/upgrade', async () => {
    await execShellAsync('bash -c "$(curl -fsSL https://get.coollabs.io/coolify/upgrade-p1.sh)"');
    // await saveServerLog({ message: upgradeP1, type: 'UPGRADE-P-1' });
    execShellAsync(
      'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -u root coolify bash -c "$(curl -fsSL https://get.coollabs.io/coolify/upgrade-p2.sh)"',
    );
    return {
      success: true,
      message: "I'm trying, okay?",
    }
  });
};

export default route;
