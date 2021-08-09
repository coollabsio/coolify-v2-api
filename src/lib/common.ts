import shell from 'shelljs';
import fetch from 'node-fetch'
import dayjs from 'dayjs';
import LogsApplication from '$models/LogsApplication';

const patterns = [
	'[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
	'(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
].join('|');

function generateTimestamp() {
	return `${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')} `;
}


export async function saveAppLog(event, configuration, isError?: boolean) {
	try {
		const deployId = configuration.general.deployId;
		const repoId = configuration.repository.id;
		const branch = configuration.repository.branch;
		if (isError) {
			const clearedEvent =
				'[ERROR 😱] ' +
				generateTimestamp() +
				event.replace(new RegExp(patterns, 'g'), '').replace(/(\r\n|\n|\r)/gm, '');
			await new LogsApplication({ repoId, branch, deployId, event: clearedEvent }).save();
		} else {
			if (event && event !== '\n') {
				const clearedEvent =
					'[INFO] ' +
					generateTimestamp() +
					event.replace(new RegExp(patterns, 'g'), '').replace(/(\r\n|\n|\r)/gm, '');
				await new LogsApplication({ repoId, branch, deployId, event: clearedEvent }).save();
			}
		}
	} catch (error) {
		console.log(error);
		return error;
	}
}

export function execShellAsync(cmd, opts = {}): any {
  try {
    return new Promise(function (resolve, reject) {
      shell.config.silent = true;
      shell.exec(cmd, opts, async function (code, stdout, stderr) {
        if (code !== 0) {
          // await saveServerLog({ message: JSON.stringify({ cmd, opts, code, stdout, stderr }) });
          return reject(new Error(stderr));
        }
        return resolve(stdout);
      });
    });
  } catch (error) {
    return new Error('Oops');
  }
}

export function cleanupTmp(dir) {
  if (dir !== '/') shell.rm('-fr', dir);
}

export function delay(t) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve('OK');
    }, t);
  });
}

export function compareObjects(a, b) {
  if (a === b) return true;

  if (typeof a != 'object' || typeof b != 'object' || a == null || b == null) return false;

  const keysA = Object.keys(a),
    keysB = Object.keys(b);

  if (keysA.length != keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;

    if (typeof a[key] === 'function' || typeof b[key] === 'function') {
      if (a[key].toString() != b[key].toString()) return false;
    } else {
      if (!compareObjects(a[key], b[key])) return false;
    }
  }

  return true;
}

export async function githubAPI(
	request: any,
	resource: string,
	token?: string,
	data?: Record<string, unknown>
) {
	const base = 'https://api.github.com';
	const res = await fetch(`${base}${resource}`, {
		method: request.method,
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
			authorization: token ? `token ${token}` : ''
		},
		body: data && JSON.stringify(data)
	});
	return {
		status: res.status,
		body: await res.json()
	};
}