import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';

@ApiTags('documents')
@Authenticated()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a document and attach it to an entity' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string' },
        entityId: { type: 'string' },
      },
      required: ['file', 'entityType', 'entityId'],
    },
  })
  async upload(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('entityType') entityType: string,
    @Body('entityId') entityId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!entityType) throw new BadRequestException('entityType is required');
    if (!entityId) throw new BadRequestException('entityId is required');

    return this.documentsService.upload(orgId, userId, file, entityType, entityId);
  }

  @Get()
  @ApiOperation({ summary: 'List documents, optionally filtered by entity' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  list(
    @CurrentOrgId() orgId: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.documentsService.list(orgId, entityType, entityId);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Get a presigned download URL for a document' })
  getDownloadUrl(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.documentsService.getDownloadUrl(orgId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document from storage and the database' })
  delete(@CurrentOrgId() orgId: string, @Param('id') id: string) {
    return this.documentsService.delete(orgId, id);
  }
}
