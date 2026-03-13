import { Controller, Get, Post, Param, Query, Body, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { NotificationPreferencesInput, NotificationsService } from './notifications.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['all', 'read', 'unread'] })
  @ApiQuery({ name: 'sort', required: false, enum: ['newest', 'oldest'] })
  list(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('type') type?: string,
    @Query('status') status?: 'all' | 'read' | 'unread',
    @Query('sort') sort?: 'newest' | 'oldest',
  ) {
    return this.notificationsService.list(orgId, userId, {
      unreadOnly: unreadOnly === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      type: type || undefined,
      status: status || undefined,
      sort: sort || undefined,
    });
  }

  @Get('types')
  @ApiOperation({ summary: 'List notification types for current user' })
  types(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.notificationsService.getAvailableTypes(orgId, userId);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences for current user' })
  preferences(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.notificationsService.getPreferences(orgId, userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences for current user' })
  updatePreferences(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() body: NotificationPreferencesInput,
  ) {
    return this.notificationsService.upsertPreferences(orgId, userId, body);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for current user' })
  unreadCount(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.notificationsService.getUnreadCount(orgId, userId);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ) {
    return this.notificationsService.markRead(id, userId);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ) {
    return this.notificationsService.markAllRead(orgId, userId);
  }
}
