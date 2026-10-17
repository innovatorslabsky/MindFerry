// A stand-in parser for testing the process runner: it speaks the same protocol as the real one
// (one job in, one reply out) but its jobs are experiments on its own sandbox.
const fs = require('node:fs');

function attempt(fn) {
  try {
    fn();
    return { allowed: true };
  } catch (error) {
    return { allowed: false, code: error && error.code ? error.code : String(error && error.name) };
  }
}

process.once('message', (job) => {
  const reply = (payload) => process.send(payload, () => process.exit(0));
  switch (job.action) {
    case 'env':
      return reply({
        ok: true,
        result: { env: process.env, execArgv: process.execArgv, pid: process.pid },
      });
    case 'sandbox':
      return reply({
        ok: true,
        result: {
          readOwn: attempt(() => fs.readFileSync(__filename, 'utf8').length > 0),
          readOutside: attempt(() => fs.readFileSync('/etc/passwd', 'utf8').length > 0),
          write: attempt(() => fs.writeFileSync('/tmp/library-probe-write', 'x')),
          spawn: attempt(() => require('node:child_process').execSync('id').toString()),
          worker: attempt(() => new (require('node:worker_threads').Worker)('1', { eval: true })),
        },
      });
    case 'hang':
      return setInterval(() => {}, 1000);
    case 'exit':
      return process.exit(job.code ?? 3);
    case 'oom': {
      const hoard = [];
      for (;;) hoard.push(new Array(1_000_000).fill(Math.random()));
    }
    case 'reply':
      return reply(job.payload);
    case 'garbage':
      return reply('not a reply');
    case 'echoSize':
      return reply({
        ok: true,
        result: { received: job.bytes.byteLength, isUint8Array: job.bytes instanceof Uint8Array },
      });
    default:
      return reply({ ok: false, error: { name: 'Error', message: 'unknown action' } });
  }
});
