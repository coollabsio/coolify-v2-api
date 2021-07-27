import type { FastifyPluginAsync } from 'fastify';
import { docker } from '$lib/docker';
import Configuration from '$models/Configuration';

const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.get('/dashboard', async () => {
    const dockerServices = await docker.engine.listServices();
    let databases: any = dockerServices.filter(
      (r) =>
        r.Spec.Labels.managedBy === 'coolify' &&
        r.Spec.Labels.type === 'database' &&
        r.Spec.Labels.configuration,
    );
    let services: any = dockerServices.filter(
      (r) =>
        r.Spec.Labels.managedBy === 'coolify' &&
        r.Spec.Labels.type === 'service' &&
        r.Spec.Labels.configuration,
    );
    databases = databases.map((r) => {
      if (JSON.parse(r.Spec.Labels.configuration)) {
        return {
          configuration: JSON.parse(r.Spec.Labels.configuration),
        };
      }
      return {};
    });
    services = services.map((r) => {
      if (JSON.parse(r.Spec.Labels.configuration)) {
        return {
          serviceName: r.Spec.Labels.serviceName,
          configuration: JSON.parse(r.Spec.Labels.configuration),
        };
      }
      return {};
    });
    const configurations = await Configuration.find({
      'general.pullRequest': { $in: [null, 0] },
    }).select('-_id -__v -createdAt');
    const applications = [];
    for (const configuration of configurations) {
      const foundPRDeployments = await Configuration.find({
        'repository.id': configuration.repository.id,
        'repository.branch': configuration.repository.branch,
        'general.pullRequest': { $ne: 0 },
      }).select('-_id -__v -createdAt');
      const payload = {
        configuration,
        UpdatedAt: configuration.updatedAt,
        prBuilds: foundPRDeployments.length > 0 ? true : false,
      };
      applications.push(payload);
    }
    return {
      success: true,
      applications: {
        deployed: applications,
      },
      databases: {
        deployed: databases,
      },
      services: {
        deployed: services,
      },
    };
  });
};

export default route;
