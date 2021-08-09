import type { FastifyPluginAsync } from 'fastify';

import Configuration from '$models/Configuration';
import Deployment from '$models/Deployment';
import LogsApplication from '$models/LogsApplication';

import { docker } from '$lib/docker';
import { setDefaultConfiguration, updateServiceLabels } from '$lib/applications/configuration';
import { execShellAsync, cleanupTmp } from '$lib/common';
import { cloneGithubRepository } from '$lib/applications/repository';
import queueAndBuild from '$lib/applications/queueAndBuild';
import preChecks from '$lib/applications/preChecks';
import preTasks from '$lib/applications/preTasks';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';


interface ParamsStringLogsDeployId {
    deployId: string;
}
interface DeployLogs {
    repoId: string;
    branch: string;
    page: string;
}

interface Logs {
    name: string;
}

interface BodyRemove {
    nickname: string;
}
const route: FastifyPluginAsync = async (fastify, options) => {
    fastify.post('/applications/config', async (request, reply) => {
        const { nickname }: any = request.body || {};
        if (nickname) {
            const configurationFound = await Configuration.find({
                'general.nickname': nickname,
            }).select('-_id -__v -createdAt -updatedAt');
            if (configurationFound) {
                return {
                    configuration: [...configurationFound],
                };
            }

            const services = await docker.engine.listServices();
            const applications = services.filter(
                (r) => r.Spec.Labels.managedBy === 'coolify' && r.Spec.Labels.type === 'application',
            );
            const found = applications.find((r) => {
                const configuration = r.Spec.Labels.configuration
                    ? JSON.parse(r.Spec.Labels.configuration)
                    : null;

                if (configuration.general.nickname === nickname) return r;
                return null;
            });

            if (found) {
                return {
                    success: true,
                    ...JSON.parse(found.Spec.Labels.configuration),
                };
            }
            throw new Error('No configuration found.');
        }
    });
    fastify.post('/applications/check', async (request, reply) => {
        try {
            const { DOMAIN } = process.env;
            const configuration = setDefaultConfiguration(request.body);
            const sameDomainAndPath = await Configuration.find({
                'publish.path': configuration.publish.path,
                'publish.domain': configuration.publish.domain,
            }).select('-_id -__v -createdAt -updatedAt');
            if (sameDomainAndPath.length > 1 || configuration.publish.domain === DOMAIN) {
                return {
                    success: false,
                    message: 'Domain/path are already in use.',
                };
            }
            return {
                success: true,
                message: 'OK',
            };
        } catch (error) {
            // await saveServerLog(error);
            throw new Error(error.message || error);
        }
    });
    fastify.get<{ Querystring: Logs }>('/applications/logs', async (request, reply) => {
        try {
            const name = request.query.name;
            const service = await docker.engine.getService(`${name}_${name}`);
            const logs = (await service.logs({ stdout: true, stderr: true, timestamps: true }))
                .toString()
                .split('\n')
                .map((l) => l.slice(8))
                .filter((a) => a);
            return {
                success: true,
                logs
            };
        } catch (error) {
            console.log(error);
            // await saveServerLog(error);
            throw new Error('No such service. Is it under deployment?');
        }
    });
    fastify.post('/applications/previewDeployments', async (request, reply) => {
        const { name, organization, branch, isPreviewDeploymentEnabled }: any = request.body || {};
        if (name && organization && branch) {
            const configuration = await Configuration.findOneAndUpdate(
                {
                    'repository.name': name,
                    'repository.organization': organization,
                    'repository.branch': branch,
                },
                {
                    $set: {
                        'general.isPreviewDeploymentEnabled': isPreviewDeploymentEnabled,
                        'general.pullRequest': 0,
                    },
                },
                { new: true },
            ).select('-_id -__v -createdAt -updatedAt');
            if (!isPreviewDeploymentEnabled) {
                const found = await Configuration.find({
                    'repository.name': name,
                    'repository.organization': organization,
                    'repository.branch': branch,
                    'general.pullRequest': { $ne: 0 },
                });
                for (const prDeployment of found) {
                    await Configuration.findOneAndRemove({
                        'repository.name': name,
                        'repository.organization': organization,
                        'repository.branch': branch,
                        'publish.domain': prDeployment.publish.domain,
                    });
                    const deploys = await Deployment.find({
                        organization,
                        branch,
                        name,
                        domain: prDeployment.publish.domain,
                    });
                    for (const deploy of deploys) {
                        await LogsApplication.deleteMany({ deployId: deploy.deployId });
                        await Deployment.deleteMany({ deployId: deploy.deployId });
                    }
                    await execShellAsync(`docker stack rm ${prDeployment.build.container.name}`);
                }
                return {
                    success: true,
                    organization,
                    name,
                    branch,
                };
            }
            updateServiceLabels(configuration);
            return {
                success: true,
            };
        }
        throw new Error('Cannot save.');
    });
    fastify.post<{ Body: BodyRemove }>('/applications/remove', async (request, reply) => {
        const { nickname } = request.body;
        try {
            const configurationFound = await Configuration.findOne({
                'general.nickname': nickname,
            });
            if (configurationFound) {
                const id = configurationFound._id;
                if (configurationFound?.general?.pullRequest === 0) {
                    // Main deployment deletion request; deleting main + PRs
                    const allConfiguration = await Configuration.find({
                        'publish.domain': { $regex: `.*${configurationFound.publish.domain}`, $options: 'i' },
                        'publish.path': configurationFound.publish.path,
                    });
                    for (const config of allConfiguration) {
                        await execShellAsync(`docker stack rm ${config.build.container.name}`);
                    }
                    await Configuration.deleteMany({
                        'publish.domain': { $regex: `.*${configurationFound.publish.domain}`, $options: 'i' },
                        'publish.path': configurationFound.publish.path,
                    });
                    const deploys = await Deployment.find({ nickname });
                    for (const deploy of deploys) {
                        await LogsApplication.deleteMany({ deployId: deploy.deployId });
                        await Deployment.deleteMany({ deployId: deploy.deployId });
                    }
                } else {
                    // Delete only PRs
                    await Configuration.findByIdAndRemove(id);
                    await execShellAsync(`docker stack rm ${configurationFound.build.container.name}`);
                    const deploys = await Deployment.find({ nickname });
                    for (const deploy of deploys) {
                        await LogsApplication.deleteMany({ deployId: deploy.deployId });
                        await Deployment.deleteMany({ deployId: deploy.deployId });
                    }
                }
            }

            return {};
        } catch (error) {
            console.log(error);
            throw new Error('Nothing to do.');
        }
    });
    fastify.get<{ Querystring: DeployLogs }>('/applications/deploy/logs', async (request, reply) => {
        try {
            dayjs.extend(utc);
            dayjs.extend(relativeTime);
            const repoId = request.query.repoId;
            const branch = request.query.branch;
            const page = request.query.page;
            const onePage = 5;
            const show = Number(page) * onePage || 5;
            const deploy: any = await Deployment.find({ repoId, branch })
                .select('-_id -__v -repoId')
                .sort({ createdAt: 'desc' })
                .limit(show);
            const finalLogs = deploy.map((d) => {
                const finalLogs = { ...d._doc };
                const updatedAt = dayjs(d.updatedAt).utc();
                finalLogs.took = updatedAt.diff(dayjs(d.createdAt)) / 1000;
                finalLogs.since = updatedAt.fromNow();
                finalLogs.isPr = d.domain.startsWith('pr');
                return finalLogs;
            });
            return {
                success: true,
                logs: finalLogs,
            };
        } catch (error) {
            throw new Error(error.message || error);
        }
    });
    fastify.get<{ Params: ParamsStringLogsDeployId }>('/applications/deploy/logs/:deployId', async (request, reply) => {
        const { deployId } = request.params;
        try {
            const logs: any = await LogsApplication.find({ deployId })
                .select('-_id -__v')
                .sort({ createdAt: 'asc' });

            const deploy: any = await Deployment.findOne({ deployId }).select('-_id -__v');
            const finalLogs: any = {};
            finalLogs.progress = deploy.progress;
            finalLogs.events = logs.map((log) => log.event);
            finalLogs.human = dayjs(deploy.updatedAt).from(dayjs(deploy.updatedAt));
            return {
                ...finalLogs,
            };
        } catch (error) {
            throw new Error(error.message || error)
        }
    });
    fastify.post('/applications/deploy', async (request, reply) => {
        const configuration = setDefaultConfiguration(request.body);
        if (!configuration) throw new Error('Whaaat?');
        try {
            await cloneGithubRepository(configuration);
            const nextStep = await preChecks(configuration);
            console.log(nextStep)
            if (nextStep === 0) {
                cleanupTmp(configuration.general.workdir);
                return {
                    success: false,
                    message: 'Nothing changed, no need to redeploy.',
                };
            }
            await preTasks(configuration);

            queueAndBuild(configuration, nextStep);
            return {
                success: true,
                message: 'Deployment queued.',
                nickname: configuration.general.nickname,
                name: configuration.build.container.name,
                deployId: configuration.general.deployId,
            };
        } catch (error) {
            console.log(error);
            await Deployment.findOneAndUpdate(
                { nickname: configuration.general.nickname },
                { $set: { progress: 'failed' } },
            );
            throw new Error(error.message || error);
        }
    });
};

export default route;
