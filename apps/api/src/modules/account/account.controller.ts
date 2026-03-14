import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AccountService } from './account.service';

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the signed-in user account profile' })
  getMe(@CurrentUserId() userId: string) {
    return this.accountService.getMe(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the signed-in user profile' })
  updateMe(@CurrentUserId() userId: string, @Body() body: { name?: string }) {
    return this.accountService.updateMe(userId, body);
  }

  @Post('me/change-password')
  @ApiOperation({ summary: 'Change the signed-in user password' })
  changePassword(
    @Req() req: Request,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.accountService.changePassword(req.headers.authorization, body);
  }

  @Post('me/email/change-request')
  @ApiOperation({ summary: 'Request an email change for the signed-in user' })
  requestEmailChange(@CurrentUserId() userId: string, @Body() body: { email?: string }) {
    if (!body.email) throw new BadRequestException('Email is required');
    return this.accountService.requestEmailChange(userId, body.email);
  }

  @Post('me/email/verify')
  @Public()
  @ApiOperation({ summary: 'Verify a pending email change using a token' })
  verifyEmailChange(@Body() body: { token?: string }) {
    if (!body.token) throw new BadRequestException('Verification token is required');
    return this.accountService.verifyEmailChange(body.token);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a custom avatar for the signed-in user' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  uploadAvatar(@CurrentUserId() userId: string, @UploadedFile() file: Express.Multer.File) {
    return this.accountService.uploadAvatar(userId, file);
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the signed-in user custom avatar' })
  async removeAvatar(@CurrentUserId() userId: string) {
    await this.accountService.removeAvatar(userId);
  }
}
