const { Collector } = require('./server');

const port = parseInt(process.env.COLLECTOR_PORT, 10) || 8787;
const refreshMs = parseInt(process.env.COLLECTOR_REFRESH_MS, 10) || 30000;

const collector = new Collector({ port, refreshMs });

collector.start().then(({ token, generated, url }) => {
  console.log('usage-widget collector listening on ' + url);
  console.log('read token: ' + token + (generated ? '  (generated - paste into Settings)' : ''));
  for (const w of collector.warnings) console.warn('warning: ' + w);
}).catch(err => {
  console.error(err.code === 'EADDRINUSE'
    ? 'port ' + port + ' is already in use - is another collector running?'
    : 'collector failed to start: ' + err.message);
  process.exit(1);
});

const shutdown = () => {
  collector.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
