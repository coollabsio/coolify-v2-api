import shell from 'shelljs';

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
