import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { InventoryItem } from '../items/item.entity.js';
import { CreateInventoryItems1794549000000 } from './migrations/1794549000000-CreateInventoryItems.js';

/** compose.yaml의 개발용 DB. .env의 DATABASE_URL로 바꿀 수 있다. */
export const DEFAULT_DATABASE_URL =
  'postgres://fridge:fridge@localhost:5433/fridge';

export function databaseOptions(url: string): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url,
    // 경로 glob 대신 클래스를 직접 넣는다: 빌드된 dist(.js)와 테스트(.ts) 양쪽에서 똑같이 동작한다
    entities: [InventoryItem],
    migrations: [CreateInventoryItems1794549000000],
    // 서버가 뜰 때 안 돌린 마이그레이션을 적용한다. 테이블을 엔티티에 맞춰 자동으로 고치는 synchronize는 쓰지 않는다
    migrationsRun: true,
    synchronize: false,
    retryAttempts: 3,
    retryDelay: 1000,
  };
}
