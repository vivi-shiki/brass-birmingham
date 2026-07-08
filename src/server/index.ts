import path from 'node:path';
import {createBrassServer} from './createServer';
import {gameStore} from './gameStore';
import {listenOptionsFromEnv} from './listenOptions';

const {server} = createBrassServer({
  store: gameStore,
  clientDist: path.join(process.cwd(), 'dist', 'client'),
});

const listenOptions = listenOptionsFromEnv(process.env);

server.listen(listenOptions.port, listenOptions.host, () => {
  console.log(`Brass server listening on ${listenOptions.url}`);
});
