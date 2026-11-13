import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Category, Storage } from '../common/food.js';

/** 유통기한이 어디서 왔는지: 포장에서 읽음 / 보관 일수로 추정 / 사용자가 직접 */
export const EXPIRY_SOURCES = ['label', 'estimated', 'user'] as const;
export type ExpirySource = (typeof EXPIRY_SOURCES)[number];

/** 어떻게 등록했는지: 사진 인식 / 직접 입력 */
export const ITEM_SOURCES = ['photo', 'manual'] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/** 있음 / 다 먹음 / 버림. 다 먹거나 버린 것도 통계를 위해 지우지 않는다. */
export const ITEM_STATUSES = ['active', 'consumed', 'discarded'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * 재고 한 묶음 — 한 번에 산 같은 물건. 산 날·유통기한이 다르면 다른 행이다.
 * 테이블·제약·인덱스는 마이그레이션(src/database/migrations)이 만든다. synchronize는 쓰지 않는다.
 */
@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'product_name', type: 'text', nullable: true })
  productName: string | null;

  @Column({ type: 'text' })
  category: Category;

  @Column({ type: 'text' })
  emoji: string;

  /** 남은 개수. 다 먹으면 0, 버리면 버린 때의 개수 그대로 */
  @Column({ type: 'integer' })
  quantity: number;

  @Column({ type: 'text' })
  unit: string;

  @Column({ type: 'text' })
  storage: Storage;

  /** YYYY-MM-DD. 시간대 없이 날짜만 — D-day는 폰이 자기 시간대로 계산한다 */
  @Column({ name: 'expires_on', type: 'date' })
  expiresOn: string;

  @Column({ name: 'expiry_source', type: 'text' })
  expirySource: ExpirySource;

  @Column({ type: 'text' })
  source: ItemSource;

  @Column({ type: 'text', default: 'active' })
  status: ItemStatus;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
