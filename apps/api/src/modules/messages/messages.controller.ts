import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
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

  @Get(':threadType/:threadId')
  @ApiOperation({ summary: 'List messages on a PO/RFQ/GRN/invoice thread' })
  list(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.messagesService.list(orgId, parseThreadType(threadType), threadId);
  }

  @Post(':threadType/:threadId')
  @ApiOperation({ summary: 'Post a message to a PO/RFQ/GRN/invoice thread' })
  post(
    @Param('threadType') threadType: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() body: PostMessageInput,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.messagesService.postAsUser(
      orgId,
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
