import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatsService } from './chats.service';
import { ListMessagesQueryDto, SendMessageDto, StartChatDto } from './dto/chat.dto';

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('chats')
export class ChatsController {
  constructor(private readonly svc: ChatsService) {}

  /** My chats, most recent activity first, with the other members, a preview and unread counts. */
  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.listChats(user.id);
  }

  /** Starts a chat with someone you work with, or returns the one you already have. */
  @Post()
  @HttpCode(200)
  @Throttle({ short: { ttl: 1_000, limit: 3 }, medium: { ttl: 60_000, limit: 30 } })
  start(@Body() body: StartChatDto, @CurrentUser() user: User) {
    return this.svc.startChat(user, body.userId, body.projectId);
  }

  @Get(':id/messages')
  messages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListMessagesQueryDto,
    @CurrentUser() user: User,
  ) {
    return this.svc.listMessages(user, id, query.before, query.limit);
  }

  /** Sends a message. Returns `warning` when it looks like an attempt to move off the platform. */
  @Post(':id/messages')
  @Throttle({ short: { ttl: 1_000, limit: 3 }, medium: { ttl: 60_000, limit: 40 } })
  send(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: SendMessageDto, @CurrentUser() user: User) {
    return this.svc.sendMessage(user, id, body.body);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: User) {
    return this.svc.markRead(user, id);
  }
}
