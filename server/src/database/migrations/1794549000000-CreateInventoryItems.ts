import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 재고 테이블. 앱 코드가 막아도 DB에 이상한 값이 들어가지 않게 CHECK로 한 번 더 막는다.
 * 카테고리 목록은 src/common/food.ts를 import하지 않고 그대로 적는다:
 * 마이그레이션은 만든 시점의 모습으로 고정돼 있어야 한다 (나중에 목록이 바뀌면 새 마이그레이션으로).
 */
export class CreateInventoryItems1794549000000 implements MigrationInterface {
  name = 'CreateInventoryItems1794549000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inventory_items (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name          text        NOT NULL CHECK (length(btrim(name)) > 0),
        product_name  text,
        category      text        NOT NULL CHECK (category IN (
                        'vegetable', 'fruit', 'meat_egg', 'seafood', 'dairy', 'tofu_processed',
                        'side_dish', 'sauce', 'beverage', 'ready_meal', 'other')),
        emoji         text        NOT NULL,
        quantity      integer     NOT NULL CHECK (quantity >= 0),
        unit          text        NOT NULL,
        storage       text        NOT NULL CHECK (storage IN ('fridge', 'freezer', 'pantry')),
        expires_on    date        NOT NULL,
        expiry_source text        NOT NULL CHECK (expiry_source IN ('label', 'estimated', 'user')),
        source        text        NOT NULL CHECK (source IN ('photo', 'manual')),
        status        text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'consumed', 'discarded')),
        finished_at   timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        -- 있는 재료는 1개 이상, 끝난 시각이 없다. 끝난 재료는 끝난 시각이 있다.
        CONSTRAINT inventory_items_active_check CHECK (
          (status = 'active' AND quantity >= 1 AND finished_at IS NULL)
          OR (status <> 'active' AND finished_at IS NOT NULL)
        )
      )
    `);
    // 홈 화면: 있는 재료를 유통기한 순으로
    await queryRunner.query(
      `CREATE INDEX inventory_items_status_expires_on_idx ON inventory_items (status, expires_on)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE inventory_items`);
  }
}
