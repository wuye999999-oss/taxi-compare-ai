import { startServer } from './server2.js';

const port = Number(process.env.PORT || 3000);
startServer(port);
