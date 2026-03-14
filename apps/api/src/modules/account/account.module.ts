import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [SettingsModule, StorageModule],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
