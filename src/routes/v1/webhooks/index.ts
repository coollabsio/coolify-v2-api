import type { FastifyPluginAsync } from 'fastify';
import * as crypto from 'crypto';
import Configuration from '$models/Configuration';
import { precheckDeployment, setDefaultConfiguration } from '$lib/applications/configuration';
import { cleanupTmp, execShellAsync } from '$lib/common';
import LogsApplication from '$models/LogsApplication';
import Deployment from '$models/Deployment';
import { cloneGithubRepository } from '$lib/applications/repository';
import queueAndBuild from '$lib/applications/queueAndBuild';
import { cleanupStuckedDeploymentsInDB } from '$lib/applications/cleanup';

interface Body {
  ref: string;
  action: string;
  number: string;
  repository: {
    id: string;
  };
}
interface Headers {
  'x-hub-signature-256': string;
  'x-github-event': string;
}
const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.post<{ Body: Body; Headers: Headers }>('/webhooks/deploy', async (request, reply) => {
    let configuration;
    const allowedGithubEvents = ['push', 'pull_request'];
    const allowedPRActions = ['opened', 'reopened', 'synchronize', 'closed'];
    const githubEvent = request.headers['x-github-event'];
    const { GITHUP_APP_WEBHOOK_SECRET } = process.env;
    const hmac = crypto.createHmac('sha256', GITHUP_APP_WEBHOOK_SECRET);
    const digest = Buffer.from(
      'sha256=' + hmac.update(JSON.stringify(request.body)).digest('hex'),
      'utf8',
    );
    const checksum = Buffer.from(request.headers['x-hub-signature-256'], 'utf8');
    if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
      throw new Error('Invalid Request.');
    }
    if (!allowedGithubEvents.includes(githubEvent)) {
      throw new Error('Invalid Event.');
    }
    try {
      const applications = await Configuration.find({
        'repository.id': request.body.repository.id,
      }).select('-_id -__v -createdAt -updatedAt');
      if (githubEvent === 'push') {
        configuration = applications.find((r) => {
          if (request.body.ref.startsWith('refs')) {
            if (r.repository.branch === request.body.ref.split('/')[2]) {
              return r;
            }
          }
          return null;
        });
      } else if (githubEvent === 'pull_request') {
        if (!allowedPRActions.includes(request.body.action)) {
          throw new Error('PR action is not allowed.');
        }
        configuration = applications.find(
          (r) => r.repository.branch === request.body['pull_request'].base.ref,
        );
        if (configuration) {
          if (!configuration.general.isPreviewDeploymentEnabled) {
            throw new Error('PR action is not enabled.');
          }
          configuration.general.pullRequest = request.body.number;
        }
      }
      if (!configuration) {
        throw new Error('No configuration found.');
      }
      configuration = setDefaultConfiguration(configuration);
      const { id, organization, name, branch } = configuration.repository;
      const { domain } = configuration.publish;
      const { deployId, nickname, pullRequest } = configuration.general;

      if (request.body.action === 'closed') {
        const deploys = await Deployment.find({ organization, branch, name, domain });
        for (const deploy of deploys) {
          await LogsApplication.deleteMany({ deployId: deploy.deployId });
          await Deployment.deleteMany({ deployId: deploy.deployId });
        }
        await Configuration.findOneAndRemove({
          'repository.id': id,
          'repository.organization': organization,
          'repository.name': name,
          'repository.branch': branch,
          'general.pullRequest': pullRequest,
        });
        await execShellAsync(`docker stack rm ${configuration.build.container.name}`);
        return {
          success: true,
          message: 'Removed',
        };
      }
      await cloneGithubRepository(configuration);
      const { foundService, imageChanged, configChanged, forceUpdate } = await precheckDeployment(
        configuration,
      );
      if (foundService && !forceUpdate && !imageChanged && !configChanged) {
        cleanupTmp(configuration.general.workdir);
        return {
          success: false,
          message: 'Nothing changed, no need to redeploy.',
        };
      }
      const alreadyQueued = await Deployment.find({
        repoId: id,
        branch: branch,
        organization: organization,
        name: name,
        domain: domain,
        progress: { $in: ['queued', 'inprogress'] },
      });
      if (alreadyQueued.length > 0) {
        return {
          success: false,
          message: 'Already in the queue.',
        };
      }
      await new Deployment({
        repoId: id,
        branch,
        deployId,
        domain,
        organization,
        name,
        nickname,
      }).save();
      if (githubEvent === 'pull_request') {
        await Configuration.findOneAndUpdate(
          {
            'repository.id': id,
            'repository.organization': organization,
            'repository.name': name,
            'repository.branch': branch,
            'general.pullRequest': pullRequest,
          },
          { ...configuration },
          { upsert: true, new: true },
        );
      } else {
        await Configuration.findOneAndUpdate(
          {
            'repository.id': id,
            'repository.organization': organization,
            'repository.name': name,
            'repository.branch': branch,
            'general.pullRequest': { $in: [null, 0] },
          },
          { ...configuration },
          { upsert: true, new: true },
        );
      }
      queueAndBuild(configuration, imageChanged);
      return {
        message: 'Deployment queued.',
        nickname: configuration.general.nickname,
        name: configuration.build.container.name,
        deployId: configuration.general.deployId,
      };
    } catch (error) {
      if (configuration) {
        cleanupTmp(configuration.general.workdir);
        await Deployment.findOneAndUpdate(
          {
            repoId: configuration.repository.id,
            branch: configuration.repository.branch,
            organization: configuration.repository.organization,
            name: configuration.repository.name,
            domain: configuration.publish.domain,
          },
          {
            repoId: configuration.repository.id,
            branch: configuration.repository.branch,
            organization: configuration.repository.organization,
            name: configuration.repository.name,
            domain: configuration.publish.domain,
            progress: 'failed',
          },
        );
      }

      throw new Error(error);
    } finally {
      try {
        await cleanupStuckedDeploymentsInDB();
      } catch (error) {
        console.log(error);
      }
    }
  });
};

export default route;
