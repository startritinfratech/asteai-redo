import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * socket.io adapter with the same CORS allow-list as the REST API.
 * In main.ts: `app.useWebSocketAdapter(new ChatsIoAdapter(app, origins));`
 *
 * Single instance only: rooms are kept in memory. Before running more than one API
 * task, extend this with `@socket.io/redis-adapter` (server.adapter(createAdapter(pub, sub)))
 * so emits reach sockets on every instance.
 */
export class ChatsIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly origins: string[]) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
      // Messages are sent over REST; sockets only carry small events.
      maxHttpBufferSize: 16 * 1024,
    });
  }
}
