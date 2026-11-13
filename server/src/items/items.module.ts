import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItem } from './item.entity.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem])],
  controllers: [ItemsController],
  providers: [ItemsService],
})
export class ItemsModule {}
