import { Module } from '@nestjs/common';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalService } from './vendor-portal.service';
import { SettingsModule } from '../settings/settings.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { VendorsModule } from '../vendors/vendors.module';

@Module({
  imports: [SettingsModule, InvoicesModule, VendorsModule],
  controllers: [VendorPortalController],
  providers: [VendorPortalService],
})
export class VendorPortalModule {}
