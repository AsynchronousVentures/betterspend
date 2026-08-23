import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import {
  MessagesService,
  parseThreadType,
  type PostMessageInput,
} from './messages.service';

@ApiTags('messages')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * Threads are sensitive, so unlike the demo-friendly org fallback used
   * elsewhere, these endpoints require a real session and derive the
   * organization from it rather than trusting caller-supplied headers.
   */
  private requireSession(req: Request): string {
    if (!req.authUser?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    return req.authUser.organizationId;
  }

  @Get(':threadType/:threadId')
  @ApiOperation({ summary: 'List messages on a PO/RFQ/GRN/invoice thread' })
  list(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Req() req: Request,
  ) {
    return this.messagesService.list(
      this.requireSession(req),
      parseThreadType(threadType),
      threadId,
    );
  }

  @Post(':threadType/:threadId')
  @ApiOperation({ summary: 'Post a message to a PO/RFQ/GRN/invoice thread' })
  post(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() body: PostMessageInput,
    @Req() req: Request,
    @CurrentUserId() userId: string,
  ) {
    return this.messagesService.postAsUser(
      this.requireSession(req),
      userId,
      parseThreadType(threadType),
      threadId,
      {
        body: String(body?.body ?? ''),
        attachments: body?.attachments,
        recipientVendorId: body?.recipientVendorId,
      },
    );
  }
}
