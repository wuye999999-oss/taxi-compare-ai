export * from './server-clean.js';

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { startServer } = await import('./server-clean.js');
  startServer();
}
