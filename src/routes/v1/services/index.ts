import type { FastifyPluginAsync } from 'fastify';
import { docker } from '$lib/docker';
import { baseServiceConfiguration } from '$lib/applications/configuration';
import { cleanupTmp, execShellAsync } from '$lib/common';
import * as yaml from 'js-yaml';
import { promises as fs } from 'fs';
import * as generator from 'generate-password';

interface Params {
  serviceName: string;
}
interface Plausible {
  baseURL: string;
  email: string;
  userName: string;
  userPassword: string;
}
interface CodeServer {
  baseURL: string;
}
interface Minio {
  baseURL: string;
}
interface Nocodb {
  baseURL: string;
}
interface Wordpress {
  baseURL: string;
  remoteDB: string;
  database: {
    host: string;
    user: string;
    password: string;
    name: string;
    tablePrefix: string;
  };
  wordpressExtraConfiguration: string;
}
const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.get<{ Params: Params }>('/services/:serviceName', async (request, reply) => {
    const { serviceName } = request.params;
    try {
      const service = (await docker.engine.listServices()).find(
        (r) =>
          r.Spec.Labels.managedBy === 'coolify' &&
          r.Spec.Labels.type === 'service' &&
          r.Spec.Labels.serviceName === serviceName &&
          r.Spec.Name === `${serviceName}_${serviceName}`,
      );
      if (service) {
        const payload = {
          config: JSON.parse(service.Spec.Labels.configuration),
        };
        return {
          success: true,
          ...payload,
        };
      } else {
        return {
          success: false,
          showToast: false,
          message: 'Not found',
        };
      }
    } catch (error) {
      throw new Error(error.message || error);
    }
  });
  fastify.post<{ Body: Plausible }>('/services/deploy/plausible', async (request, reply) => {
    const { email, userName, userPassword } = request.body;
    let { baseURL } = request.body;
    const traefikURL = baseURL;
    baseURL = `https://${baseURL}`;
    const deployId = 'plausible';
    const workdir = '/tmp/plausible';
    const secretKey = generator.generate({ length: 64, numbers: true, strict: true });
    const generateEnvsPostgres = {
      POSTGRESQL_PASSWORD: generator.generate({ length: 24, numbers: true, strict: true }),
      POSTGRESQL_USERNAME: generator.generate({ length: 10, numbers: true, strict: true }),
      POSTGRESQL_DATABASE: 'plausible',
    };

    const secrets = [
      { name: 'ADMIN_USER_EMAIL', value: email },
      { name: 'ADMIN_USER_NAME', value: userName },
      { name: 'ADMIN_USER_PWD', value: userPassword },
      { name: 'BASE_URL', value: baseURL },
      { name: 'SECRET_KEY_BASE', value: secretKey },
      { name: 'DISABLE_AUTH', value: 'false' },
      { name: 'DISABLE_REGISTRATION', value: 'true' },
      {
        name: 'DATABASE_URL',
        value: `postgresql://${generateEnvsPostgres.POSTGRESQL_USERNAME}:${generateEnvsPostgres.POSTGRESQL_PASSWORD}@plausible_db:5432/${generateEnvsPostgres.POSTGRESQL_DATABASE}`,
      },
      { name: 'CLICKHOUSE_DATABASE_URL', value: 'http://plausible_events_db:8123/plausible' },
    ];

    const generateEnvsClickhouse = {};
    for (const secret of secrets) generateEnvsClickhouse[secret.name] = secret.value;

    const clickhouseConfigXml = `
          <yandex>
            <logger>
                <level>warning</level>
                <console>true</console>
            </logger>
      
            <!-- Stop all the unnecessary logging -->
            <query_thread_log remove="remove"/>
            <query_log remove="remove"/>
            <text_log remove="remove"/>
            <trace_log remove="remove"/>
            <metric_log remove="remove"/>
            <asynchronous_metric_log remove="remove"/>
        </yandex>`;
    const clickhouseUserConfigXml = `
          <yandex>
            <profiles>
                <default>
                    <log_queries>0</log_queries>
                    <log_query_threads>0</log_query_threads>
                </default>
            </profiles>
        </yandex>`;

    const clickhouseConfigs = [
      {
        source: 'plausible-clickhouse-user-config.xml',
        target: '/etc/clickhouse-server/users.d/logging.xml',
      },
      {
        source: 'plausible-clickhouse-config.xml',
        target: '/etc/clickhouse-server/config.d/logging.xml',
      },
      { source: 'plausible-init.query', target: '/docker-entrypoint-initdb.d/init.query' },
      { source: 'plausible-init-db.sh', target: '/docker-entrypoint-initdb.d/init-db.sh' },
    ];

    const initQuery = 'CREATE DATABASE IF NOT EXISTS plausible;';
    const initScript = 'clickhouse client --queries-file /docker-entrypoint-initdb.d/init.query';
    await execShellAsync(`mkdir -p ${workdir}`);
    await fs.writeFile(`${workdir}/clickhouse-config.xml`, clickhouseConfigXml);
    await fs.writeFile(`${workdir}/clickhouse-user-config.xml`, clickhouseUserConfigXml);
    await fs.writeFile(`${workdir}/init.query`, initQuery);
    await fs.writeFile(`${workdir}/init-db.sh`, initScript);
    const stack = {
      version: '3.8',
      services: {
        [deployId]: {
          image: 'plausible/analytics:latest',
          command:
            'sh -c "sleep 10 && /entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh db init-admin && /entrypoint.sh run"',
          networks: [`${docker.network}`],
          volumes: [`${deployId}-postgres-data:/var/lib/postgresql/data`],
          environment: generateEnvsClickhouse,
          deploy: {
            ...baseServiceConfiguration,
            labels: [
              'managedBy=coolify',
              'type=service',
              'serviceName=plausible',
              'configuration=' +
              JSON.stringify({
                email,
                userName,
                userPassword,
                baseURL,
                secretKey,
                generateEnvsPostgres,
                generateEnvsClickhouse,
              }),
              'traefik.enable=true',
              'traefik.http.services.' + deployId + '.loadbalancer.server.port=8000',
              'traefik.http.routers.' + deployId + '.entrypoints=websecure',
              'traefik.http.routers.' +
              deployId +
              '.rule=Host(`' +
              traefikURL +
              '`) && PathPrefix(`/`)',
              'traefik.http.routers.' + deployId + '.tls.certresolver=letsencrypt',
              'traefik.http.routers.' + deployId + '.middlewares=global-compress',
            ],
          },
        },
        plausible_db: {
          image: 'bitnami/postgresql:13.2.0',
          networks: [`${docker.network}`],
          environment: generateEnvsPostgres,
          deploy: {
            ...baseServiceConfiguration,
            labels: ['managedBy=coolify', 'type=service', 'serviceName=plausible'],
          },
        },
        plausible_events_db: {
          image: 'yandex/clickhouse-server:21.3.2.5',
          networks: [`${docker.network}`],
          volumes: [`${deployId}-clickhouse-data:/var/lib/clickhouse`],
          ulimits: {
            nofile: {
              soft: 262144,
              hard: 262144,
            },
          },
          configs: [...clickhouseConfigs],
          deploy: {
            ...baseServiceConfiguration,
            labels: ['managedBy=coolify', 'type=service', 'serviceName=plausible'],
          },
        },
      },
      networks: {
        [`${docker.network}`]: {
          external: true,
        },
      },
      volumes: {
        [`${deployId}-clickhouse-data`]: {
          external: true,
        },
        [`${deployId}-postgres-data`]: {
          external: true,
        },
      },
      configs: {
        'plausible-clickhouse-user-config.xml': {
          file: `${workdir}/clickhouse-user-config.xml`,
        },
        'plausible-clickhouse-config.xml': {
          file: `${workdir}/clickhouse-config.xml`,
        },
        'plausible-init.query': {
          file: `${workdir}/init.query`,
        },
        'plausible-init-db.sh': {
          file: `${workdir}/init-db.sh`,
        },
      },
    };
    await fs.writeFile(`${workdir}/stack.yml`, yaml.dump(stack));
    await execShellAsync('docker stack rm plausible');
    await execShellAsync(`cat ${workdir}/stack.yml | docker stack deploy --prune -c - ${deployId}`);
    cleanupTmp(workdir);
    return {
      message: 'OK',
    };
  });
  fastify.patch('/services/deploy/plausible/activate', async (request, reply) => {
    const { POSTGRESQL_USERNAME, POSTGRESQL_PASSWORD, POSTGRESQL_DATABASE } = JSON.parse(
      JSON.parse(
        await execShellAsync(
          "docker service inspect plausible_plausible --format='{{json .Spec.Labels.configuration}}'",
        ),
      ),
    ).generateEnvsPostgres;
    const containers = (await execShellAsync("docker ps -a --format='{{json .Names}}'"))
      .replace(/"/g, '')
      .trim()
      .split('\n');
    const postgresDB = containers.find((container) =>
      container.startsWith('plausible_plausible_db'),
    );
    await execShellAsync(
      `docker exec ${postgresDB} psql -H postgresql://${POSTGRESQL_USERNAME}:${POSTGRESQL_PASSWORD}@localhost:5432/${POSTGRESQL_DATABASE} -c "UPDATE users SET email_verified = true;"`,
    );
    return { messages: 'OK' };
  });
  fastify.post<{ Body: CodeServer }>('/services/deploy/code-server', async (request, reply) => {
    let { baseURL } = request.body;
    const traefikURL = baseURL;
    baseURL = `https://${baseURL}`;
    const workdir = '/tmp/code-server';
    const deployId = 'code-server';
    // const environment = [
    // 	{ name: 'DOCKER_USER', value: 'root' }

    // ];
    // const generateEnvsCodeServer = {};
    // for (const env of environment) generateEnvsCodeServer[env.name] = env.value;

    const stack = {
      version: '3.8',
      services: {
        [deployId]: {
          image: 'codercom/code-server',
          command: 'code-server --disable-telemetry',
          networks: [`${docker.network}`],
          volumes: [`${deployId}-code-server-data:/home/coder`],
          // environment: generateEnvsCodeServer,
          deploy: {
            ...baseServiceConfiguration,
            labels: [
              'managedBy=coolify',
              'type=service',
              'serviceName=code-server',
              'configuration=' +
              JSON.stringify({
                baseURL,
              }),
              'traefik.enable=true',
              'traefik.http.services.' + deployId + '.loadbalancer.server.port=8080',
              'traefik.http.routers.' + deployId + '.entrypoints=websecure',
              'traefik.http.routers.' +
              deployId +
              '.rule=Host(`' +
              traefikURL +
              '`) && PathPrefix(`/`)',
              'traefik.http.routers.' + deployId + '.tls.certresolver=letsencrypt',
              'traefik.http.routers.' + deployId + '.middlewares=global-compress',
            ],
          },
        },
      },
      networks: {
        [`${docker.network}`]: {
          external: true,
        },
      },
      volumes: {
        [`${deployId}-code-server-data`]: {
          external: true,
        },
      },
    };
    await execShellAsync(`mkdir -p ${workdir}`);
    await fs.writeFile(`${workdir}/stack.yml`, yaml.dump(stack));
    await execShellAsync('docker stack rm code-server');
    await execShellAsync(`cat ${workdir}/stack.yml | docker stack deploy --prune -c - ${deployId}`);
    cleanupTmp(workdir);
    return {
      message: 'OK',
    };
  });
  fastify.post('/services/deploy/code-server/password', async (request, reply) => {
    const containers = (await execShellAsync("docker ps -a --format='{{json .Names}}'"))
      .replace(/"/g, '')
      .trim()
      .split('\n');
    const codeServer = containers.find((container) => container.startsWith('code-server'));
    const configYaml: any = yaml.load(
      await execShellAsync(
        `docker exec ${codeServer} cat /home/coder/.config/code-server/config.yaml`,
      ),
    );
    return {
      message: 'OK',
      password: configYaml.password,
    };
  });
  fastify.post<{ Body: Minio }>('/services/deploy/minio', async (request, reply) => {
    let { baseURL } = request.body;
    const traefikURL = baseURL;
    baseURL = `https://${baseURL}`;
    const workdir = '/tmp/minio';
    const deployId = 'minio';
    const secrets = [
      {
        name: 'MINIO_ROOT_USER',
        value: generator.generate({ length: 12, numbers: true, strict: true }),
      },
      {
        name: 'MINIO_ROOT_PASSWORD',
        value: generator.generate({ length: 24, numbers: true, strict: true }),
      },
    ];
    const generateEnvsMinIO = {};
    for (const secret of secrets) generateEnvsMinIO[secret.name] = secret.value;

    const stack = {
      version: '3.8',
      services: {
        [deployId]: {
          image: 'minio/minio',
          command: 'server /data',
          networks: [`${docker.network}`],
          environment: generateEnvsMinIO,
          volumes: [`${deployId}-minio-data:/data`],
          deploy: {
            ...baseServiceConfiguration,
            labels: [
              'managedBy=coolify',
              'type=service',
              'serviceName=minio',
              'configuration=' +
              JSON.stringify({
                baseURL,
                generateEnvsMinIO,
              }),
              'traefik.enable=true',
              'traefik.http.services.' + deployId + '.loadbalancer.server.port=9000',
              'traefik.http.routers.' + deployId + '.entrypoints=websecure',
              'traefik.http.routers.' +
              deployId +
              '.rule=Host(`' +
              traefikURL +
              '`) && PathPrefix(`/`)',
              'traefik.http.routers.' + deployId + '.tls.certresolver=letsencrypt',
              'traefik.http.routers.' + deployId + '.middlewares=global-compress',
            ],
          },
        },
      },
      networks: {
        [`${docker.network}`]: {
          external: true,
        },
      },
      volumes: {
        [`${deployId}-minio-data`]: {
          external: true,
        },
      },
    };
    await execShellAsync(`mkdir -p ${workdir}`);
    await fs.writeFile(`${workdir}/stack.yml`, yaml.dump(stack));
    await execShellAsync('docker stack rm minio');
    await execShellAsync(`cat ${workdir}/stack.yml | docker stack deploy --prune -c - ${deployId}`);
    cleanupTmp(workdir);
    return {
      message: 'OK',
    };
  });
  fastify.post<{ Body: Nocodb }>('/services/deploy/nocodb', async (request, reply) => {
    let { baseURL } = request.body;
    const traefikURL = baseURL;
    baseURL = `https://${baseURL}`;
    const workdir = '/tmp/nocodb';
    const deployId = 'nocodb';
    const stack = {
      version: '3.8',
      services: {
        [deployId]: {
          image: 'nocodb/nocodb',
          networks: [`${docker.network}`],
          deploy: {
            ...baseServiceConfiguration,
            labels: [
              'managedBy=coolify',
              'type=service',
              'serviceName=nocodb',
              'configuration=' +
              JSON.stringify({
                baseURL,
              }),
              'traefik.enable=true',
              'traefik.http.services.' + deployId + '.loadbalancer.server.port=8080',
              'traefik.http.routers.' + deployId + '.entrypoints=websecure',
              'traefik.http.routers.' +
              deployId +
              '.rule=Host(`' +
              traefikURL +
              '`) && PathPrefix(`/`)',
              'traefik.http.routers.' + deployId + '.tls.certresolver=letsencrypt',
              'traefik.http.routers.' + deployId + '.middlewares=global-compress',
            ],
          },
        },
      },
      networks: {
        [`${docker.network}`]: {
          external: true,
        },
      },
    };
    await execShellAsync(`mkdir -p ${workdir}`);
    await fs.writeFile(`${workdir}/stack.yml`, yaml.dump(stack));
    await execShellAsync('docker stack rm nocodb');
    await execShellAsync(`cat ${workdir}/stack.yml | docker stack deploy --prune -c - ${deployId}`);
    cleanupTmp(workdir);
    return {
      message: 'OK',
    };
  });
  fastify.post<{ Body: Wordpress }>('/services/deploy/wordpress', async (request, reply) => {
    let { baseURL, remoteDB, database, wordpressExtraConfiguration } = request.body;
    const traefikURL = baseURL;
    baseURL = `https://${baseURL}`;
    const workdir = '/tmp/wordpress';
    const deployId = `wp-${generator.generate({ length: 5, numbers: true, strict: true })}`;
    const defaultDatabaseName = generator.generate({ length: 12, numbers: true, strict: true });
    const defaultDatabaseHost = `${deployId}-mysql`;
    const defaultDatabaseUser = generator.generate({ length: 12, numbers: true, strict: true });
    const defaultDatabasePassword = generator.generate({ length: 24, numbers: true, strict: true });
    const defaultDatabaseRootPassword = generator.generate({
      length: 24,
      numbers: true,
      strict: true,
    });
    const defaultDatabaseRootUser = generator.generate({ length: 12, numbers: true, strict: true });
    let secrets = [
      { name: 'WORDPRESS_DB_HOST', value: defaultDatabaseHost },
      { name: 'WORDPRESS_DB_USER', value: defaultDatabaseUser },
      { name: 'WORDPRESS_DB_PASSWORD', value: defaultDatabasePassword },
      { name: 'WORDPRESS_DB_NAME', value: defaultDatabaseName },
      { name: 'WORDPRESS_CONFIG_EXTRA', value: wordpressExtraConfiguration },
    ];

    const generateEnvsMySQL = {
      MYSQL_ROOT_PASSWORD: defaultDatabaseRootPassword,
      MYSQL_ROOT_USER: defaultDatabaseRootUser,
      MYSQL_USER: defaultDatabaseUser,
      MYSQL_PASSWORD: defaultDatabasePassword,
      MYSQL_DATABASE: defaultDatabaseName,
    };
    const image = 'bitnami/mysql:8.0';
    const volume = `${deployId}-mysql-data:/bitnami/mysql/data`;

    if (remoteDB) {
      secrets = [
        { name: 'WORDPRESS_DB_HOST', value: database.host },
        { name: 'WORDPRESS_DB_USER', value: database.user },
        { name: 'WORDPRESS_DB_PASSWORD', value: database.password },
        { name: 'WORDPRESS_DB_NAME', value: database.name },
        { name: 'WORDPRESS_TABLE_PREFIX', value: database.tablePrefix },
        { name: 'WORDPRESS_CONFIG_EXTRA', value: wordpressExtraConfiguration },
      ];
    }

    const generateEnvsWordpress = {};
    for (const secret of secrets) generateEnvsWordpress[secret.name] = secret.value;
    let stack = {
      version: '3.8',
      services: {
        [deployId]: {
          image: 'wordpress',
          networks: [`${docker.network}`],
          environment: generateEnvsWordpress,
          volumes: [`${deployId}-wordpress-data:/var/www/html`],
          deploy: {
            ...baseServiceConfiguration,
            labels: [
              'managedBy=coolify',
              'type=service',
              'serviceName=' + deployId,
              'configuration=' +
              JSON.stringify({
                deployId,
                baseURL,
                generateEnvsWordpress,
              }),
              'traefik.enable=true',
              'traefik.http.services.' + deployId + '.loadbalancer.server.port=80',
              'traefik.http.routers.' + deployId + '.entrypoints=websecure',
              'traefik.http.routers.' +
              deployId +
              '.rule=Host(`' +
              traefikURL +
              '`) && PathPrefix(`/`)',
              'traefik.http.routers.' + deployId + '.tls.certresolver=letsencrypt',
              'traefik.http.routers.' + deployId + '.middlewares=global-compress',
            ],
          },
        },
        [`${deployId}-mysql`]: {
          image,
          networks: [`${docker.network}`],
          environment: generateEnvsMySQL,
          volumes: [volume],
          deploy: {
            ...baseServiceConfiguration,
            labels: ['managedBy=coolify', 'type=service', 'serviceName=' + deployId],
          },
        },
      },
      networks: {
        [`${docker.network}`]: {
          external: true,
        },
      },
      volumes: {
        [`${deployId}-wordpress-data`]: {
          external: true,
        },
        [`${deployId}-mysql-data`]: {
          external: true,
        },
      },
    };
    if (remoteDB) {
      stack = {
        version: '3.8',
        services: {
          [deployId]: {
            image: 'wordpress',
            networks: [`${docker.network}`],
            environment: generateEnvsWordpress,
            volumes: [`${deployId}-wordpress-data:/var/www/html`],
            deploy: {
              ...baseServiceConfiguration,
              labels: [
                'managedBy=coolify',
                'type=service',
                'serviceName=' + deployId,
                'configuration=' +
                JSON.stringify({
                  deployId,
                  baseURL,
                  generateEnvsWordpress,
                }),
                'traefik.enable=true',
                'traefik.http.services.' + deployId + '.loadbalancer.server.port=80',
                'traefik.http.routers.' + deployId + '.entrypoints=websecure',
                'traefik.http.routers.' +
                deployId +
                '.rule=Host(`' +
                traefikURL +
                '`) && PathPrefix(`/`)',
                'traefik.http.routers.' + deployId + '.tls.certresolver=letsencrypt',
                'traefik.http.routers.' + deployId + '.middlewares=global-compress',
              ],
            },
          },
        },
        networks: {
          [`${docker.network}`]: {
            external: true,
          },
        },
        volumes: {
          [`${deployId}-wordpress-data`]: {
            external: true,
          },
        },
      };
    }
    await execShellAsync(`mkdir -p ${workdir}`);
    await fs.writeFile(`${workdir}/stack.yml`, yaml.dump(stack));
    await execShellAsync(`docker stack rm ${deployId}`);
    await execShellAsync(`cat ${workdir}/stack.yml | docker stack deploy --prune -c - ${deployId}`);
    cleanupTmp(workdir);
    return {
      message: 'OK',
    };
  });
};

export default route;
