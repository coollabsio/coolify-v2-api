import type { FastifyPluginAsync } from 'fastify';
import cuid from 'cuid';
import { execShellAsync } from '$lib/common';
import { docker } from '$lib/docker';
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';
import * as generator from 'generate-password';
import * as yaml from 'js-yaml';
import { promises as fs } from 'fs';
import * as fsCB from 'fs';

function getUniq() {
  return uniqueNamesGenerator({ dictionaries: [adjectives, animals, colors], length: 2 });
}
interface Deploy {
  type: string;
  defaultDatabaseName: string;
}
interface DeployId {
  deployId: string;
}
const route: FastifyPluginAsync = async (fastify, options) => {
  fastify.post<{ Body: Deploy }>('/databases', async (request, reply) => {
    try {
      const { type } = request.body;
      let { defaultDatabaseName } = request.body;
      const passwords = generator.generateMultiple(2, {
        length: 24,
        numbers: true,
        strict: true,
      });
      const usernames = generator.generateMultiple(2, {
        length: 10,
        numbers: true,
        strict: true,
      });
      // TODO: Query for existing db with the same name
      const nickname = getUniq();

      if (!defaultDatabaseName) defaultDatabaseName = nickname;

      const deployId = cuid();
      const configuration = {
        general: {
          workdir: `/tmp/${deployId}`,
          deployId,
          nickname,
          type,
        },
        database: {
          usernames,
          passwords,
          defaultDatabaseName,
        },
        deploy: {
          name: nickname,
        },
      };
      await execShellAsync(`mkdir -p ${configuration.general.workdir}`);
      let generateEnvs = {};
      let image = null;
      let volume = null;
      let ulimits = {};
      if (type === 'mongodb') {
        generateEnvs = {
          MONGODB_ROOT_PASSWORD: passwords[0],
          MONGODB_USERNAME: usernames[0],
          MONGODB_PASSWORD: passwords[1],
          MONGODB_DATABASE: defaultDatabaseName,
        };
        image = 'bitnami/mongodb:4.4';
        volume = `${configuration.general.deployId}-${type}-data:/bitnami/mongodb`;
      } else if (type === 'postgresql') {
        generateEnvs = {
          POSTGRESQL_PASSWORD: passwords[0],
          POSTGRESQL_USERNAME: usernames[0],
          POSTGRESQL_DATABASE: defaultDatabaseName,
        };
        image = 'bitnami/postgresql:13.2.0';
        volume = `${configuration.general.deployId}-${type}-data:/bitnami/postgresql`;
      } else if (type === 'couchdb') {
        generateEnvs = {
          COUCHDB_PASSWORD: passwords[0],
          COUCHDB_USER: usernames[0],
        };
        image = 'bitnami/couchdb:3';
        volume = `${configuration.general.deployId}-${type}-data:/bitnami/couchdb`;
      } else if (type === 'mysql') {
        generateEnvs = {
          MYSQL_ROOT_PASSWORD: passwords[0],
          MYSQL_ROOT_USER: usernames[0],
          MYSQL_USER: usernames[1],
          MYSQL_PASSWORD: passwords[1],
          MYSQL_DATABASE: defaultDatabaseName,
        };
        image = 'bitnami/mysql:8.0';
        volume = `${configuration.general.deployId}-${type}-data:/bitnami/mysql/data`;
      } else if (type === 'clickhouse') {
        image = 'yandex/clickhouse-server';
        volume = `${configuration.general.deployId}-${type}-data:/var/lib/clickhouse`;
        ulimits = {
          nofile: {
            soft: 262144,
            hard: 262144,
          },
        };
      } else if (type === 'redis') {
        image = 'bitnami/redis';
        volume = `${configuration.general.deployId}-${type}-data:/bitnami/redis/data`;
        generateEnvs = {
          REDIS_PASSWORD: passwords[0],
        };
      }

      const stack = {
        version: '3.8',
        services: {
          [configuration.general.deployId]: {
            image,
            networks: [`${docker.network}`],
            environment: generateEnvs,
            volumes: [volume],
            ulimits,
            deploy: {
              replicas: 1,
              update_config: {
                parallelism: 0,
                delay: '10s',
                order: 'start-first',
              },
              rollback_config: {
                parallelism: 0,
                delay: '10s',
                order: 'start-first',
              },
              labels: [
                'managedBy=coolify',
                'type=database',
                'configuration=' + JSON.stringify(configuration),
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
          [`${configuration.general.deployId}-${type}-data`]: {
            external: true,
          },
        },
      };
      await fs.writeFile(`${configuration.general.workdir}/stack.yml`, yaml.dump(stack));
      await execShellAsync(
        `cat ${configuration.general.workdir}/stack.yml | docker stack deploy -c - ${configuration.general.deployId}`,
      );
      return {
        message: 'Deployed.',
      };
    } catch (error) {
      console.log(error);
      // await saveServerLog(error);
      throw new Error(error);
    }
  });
  fastify.get<{ Params: DeployId }>('/databases/:deployId', async (request, reply) => {
    const { deployId } = request.params;
    try {
      const database: any = (await docker.engine.listServices()).find(
        (r) =>
          r.Spec.Labels.managedBy === 'coolify' &&
          r.Spec.Labels.type === 'database' &&
          JSON.parse(r.Spec.Labels.configuration).general.deployId === deployId,
      );

      if (database) {
        const jsonEnvs = {};
        if (database.Spec.TaskTemplate.ContainerSpec.Env) {
          for (const d of database.Spec.TaskTemplate.ContainerSpec.Env) {
            const s = d.split('=');
            jsonEnvs[s[0]] = s[1];
          }
        }
        const payload = {
          config: JSON.parse(database.Spec.Labels.configuration),
          envs: jsonEnvs || null,
        };

        return {
          ...payload,
        };
      } else {
        throw new Error('No database found.');
      }
    } catch (error) {
      throw new Error('No database found.');
    }
  });
  fastify.post<{ Params: DeployId }>('/databases/:deployId/backup', async (request, reply) => {
    const tmpdir = '/tmp/backups';
    const { deployId } = request.params;
    try {
      const now = new Date();
      const configuration = JSON.parse(
        JSON.parse(await execShellAsync(`docker inspect ${deployId}_${deployId}`))[0].Spec.Labels
          .configuration,
      );
      const type = configuration.general.type;
      const serviceId = configuration.general.deployId;
      const databaseService = (await docker.engine.listContainers()).find(
        (r) => r.Labels['com.docker.stack.namespace'] === serviceId && r.State === 'running',
      );
      const containerID = databaseService.Labels['com.docker.swarm.task.name'];
      await execShellAsync(`mkdir -p ${tmpdir}`);
      if (type === 'mongodb') {
        if (databaseService) {
          const username = configuration.database.usernames[0];
          const password = configuration.database.passwords[1];
          const databaseName = configuration.database.defaultDatabaseName;
          const filename = `${databaseName}_${now.getTime()}.gz`;
          const fullfilename = `${tmpdir}/${filename}`;
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "mkdir -p ${tmpdir};mongodump --uri='mongodb://${username}:${password}@${deployId}:27017' -d ${databaseName} --gzip --archive=${fullfilename}"`,
          );
          await execShellAsync(`docker cp ${containerID}:${fullfilename} ${fullfilename}`);
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "rm -f ${fullfilename}"`,
          );
          return {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Transfer-Encoding': 'binary',
              'Content-Disposition': `attachment; filename=${filename}`,
            },
            body: fsCB.readFileSync(`${fullfilename}`),
          };
        }
      } else if (type === 'postgresql') {
        if (databaseService) {
          const username = configuration.database.usernames[0];
          const password = configuration.database.passwords[0];
          const databaseName = configuration.database.defaultDatabaseName;
          const filename = `${databaseName}_${now.getTime()}.sql.gz`;
          const fullfilename = `${tmpdir}/${filename}`;
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "PGPASSWORD=${password} pg_dump --username ${username} -Z 9 ${databaseName}" > ${fullfilename}`,
          );
          return {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Transfer-Encoding': 'binary',
              'Content-Disposition': `attachment; filename=${filename}`,
            },
            body: fsCB.readFileSync(`${fullfilename}`),
          };
        }
      } else if (type === 'couchdb') {
        if (databaseService) {
          const databaseName = configuration.database.defaultDatabaseName;
          const filename = `${databaseName}_${now.getTime()}.tar.gz`;
          const fullfilename = `${tmpdir}/${filename}`;
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "cd /bitnami/couchdb/data/ && tar -czvf - ." > ${fullfilename}`,
          );
          return {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Transfer-Encoding': 'binary',
              'Content-Disposition': `attachment; filename=${filename}`,
            },
            body: fsCB.readFileSync(`${fullfilename}`),
          };
        }
      } else if (type === 'mysql') {
        if (databaseService) {
          const username = configuration.database.usernames[0];
          const password = configuration.database.passwords[0];
          const databaseName = configuration.database.defaultDatabaseName;
          const filename = `${databaseName}_${now.getTime()}.sql.gz`;
          const fullfilename = `${tmpdir}/${filename}`;
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "mysqldump -u ${username} -p${password} ${databaseName} | gzip -9 -" > ${fullfilename}`,
          );
          return {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Transfer-Encoding': 'binary',
              'Content-Disposition': `attachment; filename=${filename}`,
            },
            body: fsCB.readFileSync(`${fullfilename}`),
          };
        }
      } else if (type === 'redis') {
        if (databaseService) {
          const password = configuration.database.passwords[0];
          const databaseName = configuration.database.defaultDatabaseName;
          const filename = `${databaseName}_${now.getTime()}.rdb`;
          const fullfilename = `${tmpdir}/${filename}`;
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "redis-cli --pass ${password} save"`,
          );
          await execShellAsync(
            `docker cp ${containerID}:/bitnami/redis/data/dump.rdb ${fullfilename}`,
          );
          await execShellAsync(
            `docker exec -i ${containerID} /bin/bash -c "rm -f /bitnami/redis/data/dump.rdb"`,
          );
          return {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Transfer-Encoding': 'binary',
              'Content-Disposition': `attachment; filename=${filename}`,
            },
            body: fsCB.readFileSync(`${fullfilename}`),
          };
        }
      }
      return {
        status: 501,
        body: {
          error: `Backup method not implemented yet for ${type}.`,
        },
      };
    } catch (error) {
      // await saveServerLog(error);
      return {
        status: 500,
        body: {
          error: error.message || error,
        },
      };
    } finally {
      await execShellAsync(`rm -fr ${tmpdir}`);
    }
  });

};

export default route;
