import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminProductsController, ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/** Digital products: catalogue, seller lifecycle and admin review. Purchases are Phase 3. */
@Module({
  imports: [NotificationsModule],
  controllers: [ProductsController, AdminProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
