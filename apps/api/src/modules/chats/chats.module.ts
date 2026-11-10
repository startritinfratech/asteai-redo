import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatsController } from './chats.controller';
import { ChatsGateway } from './chats.gateway';
import { ChatsRealtime } from './chats.realtime';
import { ChatsService } from './chats.service';

@Module({
  // JwtModule without options: the gateway passes JWT_SECRET to verifyAsync itself.
  imports: [NotificationsModule, JwtModule.register({})],
  controllers: [ChatsController],
  providers: [ChatsService, ChatsRealtime, ChatsGateway],
  exports: [ChatsService],
})
export class ChatsModule {}
