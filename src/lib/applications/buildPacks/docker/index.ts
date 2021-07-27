import { promises as fs } from 'fs';
import { docker, streamEvents } from '$lib/docker';

export default async function (configuration: {
  general: { workdir: any };
  build: { directory: any; container: { name: any; tag: any } };
}) {
  const path = `${configuration.general.workdir}/${
    configuration.build.directory ? configuration.build.directory : ''
  }`;
  if (fs.stat(`${path}/Dockerfile`)) {
    const stream = await docker.engine.buildImage(
      { src: ['.'], context: path },
      { t: `${configuration.build.container.name}:${configuration.build.container.tag}` },
    );
    await streamEvents(stream, configuration);
  } else {
    throw new Error('No custom dockerfile found.');
  }
}
