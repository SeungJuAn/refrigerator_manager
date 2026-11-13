import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { InventoryItem } from './item.entity.js';
import { ItemsService } from './items.service.js';
import {
  ConsumeSchema,
  CreateItemsSchema,
  ItemIdSchema,
  ListItemsQuerySchema,
  UpdateItemSchema,
  type Consume,
  type CreateItems,
  type ListItemsQuery,
  type UpdateItem,
} from './items.schema.js';

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  async list(
    @Query({ schema: ListItemsQuerySchema }) query: ListItemsQuery,
  ): Promise<{ items: InventoryItem[] }> {
    return { items: await this.items.list(query) };
  }

  @Post()
  async create(
    @Body({ schema: CreateItemsSchema }) body: CreateItems,
  ): Promise<{ items: InventoryItem[] }> {
    return { items: await this.items.create(body.items) };
  }

  @Patch(':id')
  update(
    @Param('id', { schema: ItemIdSchema }) id: string,
    @Body({ schema: UpdateItemSchema }) patch: UpdateItem,
  ): Promise<InventoryItem> {
    return this.items.update(id, patch);
  }

  @Post(':id/consume')
  @HttpCode(HttpStatus.OK)
  consume(
    @Param('id', { schema: ItemIdSchema }) id: string,
    @Body({ schema: ConsumeSchema }) body: Consume,
  ): Promise<InventoryItem> {
    return this.items.consume(id, body.amount);
  }

  @Post(':id/discard')
  @HttpCode(HttpStatus.OK)
  discard(
    @Param('id', { schema: ItemIdSchema }) id: string,
  ): Promise<InventoryItem> {
    return this.items.discard(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', { schema: ItemIdSchema }) id: string): Promise<void> {
    return this.items.remove(id);
  }
}
