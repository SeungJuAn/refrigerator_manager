import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { CATEGORY_EMOJI } from '../common/food.js';
import { InventoryItem } from './item.entity.js';
import type { ListItemsQuery, NewItem, UpdateItem } from './items.schema.js';

@Injectable()
export class ItemsService {
  constructor(
    @InjectRepository(InventoryItem)
    private readonly items: Repository<InventoryItem>,
    private readonly dataSource: DataSource,
  ) {}

  /** 있는 재료는 유통기한이 가까운 순, 끝난 재료는 최근에 끝난 순 */
  list(query: ListItemsQuery): Promise<InventoryItem[]> {
    const qb = this.items
      .createQueryBuilder('item')
      .where('item.status = :status', { status: query.status })
      .take(query.limit);

    if (query.status === 'active') {
      qb.orderBy('item.expiresOn', 'ASC').addOrderBy('item.createdAt', 'ASC');
    } else {
      qb.orderBy('item.finishedAt', 'DESC');
    }
    if (query.category) {
      qb.andWhere('item.category = :category', { category: query.category });
    }
    if (query.q) {
      qb.andWhere(
        "(item.name ILIKE :q ESCAPE '\\' OR item.productName ILIKE :q ESCAPE '\\')",
        { q: `%${escapeLike(query.q)}%` },
      );
    }
    return qb.getMany();
  }

  /** 여러 개를 한 번에 등록한다. 하나라도 실패하면 전부 안 들어간다 (save가 트랜잭션으로 묶는다). */
  create(input: NewItem[]): Promise<InventoryItem[]> {
    const entities = input.map((item) =>
      this.items.create({
        ...item,
        emoji: item.emoji ?? CATEGORY_EMOJI[item.category],
        status: 'active',
        finishedAt: null,
      }),
    );
    return this.items.save(entities);
  }

  update(id: string, patch: UpdateItem): Promise<InventoryItem> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.lockActive(manager, id);
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<InventoryItem>;
      Object.assign(item, changes);
      if (patch.expiresOn !== undefined && patch.expirySource === undefined) {
        item.expirySource = 'user';
      }
      return manager.save(item);
    });
  }

  /**
   * 먹었어요. amount가 없거나 남은 수보다 많으면 전부 먹은 것으로 본다.
   * 행을 잠그고(SELECT … FOR UPDATE) 처리해서, 두 번 연달아 눌러도 수량이 꼬이지 않는다.
   */
  consume(id: string, amount?: number): Promise<InventoryItem> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.lockActive(manager, id);
      item.quantity -= Math.min(amount ?? item.quantity, item.quantity);
      if (item.quantity === 0) {
        item.status = 'consumed';
        item.finishedAt = new Date();
      }
      return manager.save(item);
    });
  }

  /** 버렸어요. 수량은 버린 개수로 남긴다. */
  discard(id: string): Promise<InventoryItem> {
    return this.dataSource.transaction(async (manager) => {
      const item = await this.lockActive(manager, id);
      item.status = 'discarded';
      item.finishedAt = new Date();
      return manager.save(item);
    });
  }

  /** 잘못 등록한 것. 통계에 섞이면 안 돼서 상태를 바꾸지 않고 지운다. */
  async remove(id: string): Promise<void> {
    const result = await this.items.delete({ id });
    if (!result.affected) throw notFound();
  }

  private async lockActive(
    manager: EntityManager,
    id: string,
  ): Promise<InventoryItem> {
    const item = await manager.findOne(InventoryItem, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) throw notFound();
    if (item.status !== 'active') {
      throw new ConflictException('이미 다 먹었거나 버린 재료입니다.');
    }
    return item;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException('재료를 찾을 수 없습니다.');
}

/** ILIKE 패턴에서 %, _, \ 를 글자 그대로 찾게 한다 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
