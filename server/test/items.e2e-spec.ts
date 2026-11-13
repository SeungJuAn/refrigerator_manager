import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

const MILK = {
  name: '우유',
  productName: '서울우유 1L',
  category: 'dairy',
  emoji: '🥛',
  quantity: 2,
  unit: '팩',
  storage: 'fridge',
  expiresOn: '2026-11-20',
  expirySource: 'label',
  source: 'photo',
};

const GREEN_ONION = {
  name: '대파',
  category: 'vegetable',
  quantity: 1,
  unit: '단',
  storage: 'fridge',
  expiresOn: '2026-11-17',
  expirySource: 'estimated',
  source: 'manual',
};

const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000';

describe('/items (e2e, 실제 PostgreSQL)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  });

  beforeEach(async () => {
    await app.get(DataSource).query('TRUNCATE inventory_items');
  });

  afterAll(async () => {
    await app.close();
  });

  async function create(...items: object[]) {
    const res = await http.post('/items').send({ items }).expect(201);
    return res.body.items as Array<Record<string, any>>;
  }

  describe('POST /items', () => {
    it('여러 개를 한 번에 등록하고, 이모지가 없으면 카테고리 기본값을 쓴다', async () => {
      const [milk, onion] = await create(MILK, GREEN_ONION);

      expect(milk).toMatchObject({
        ...MILK,
        status: 'active',
        finishedAt: null,
      });
      expect(milk.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(onion).toMatchObject({ emoji: '🥬', productName: null });
    });

    it('하나라도 잘못되면 아무것도 등록하지 않는다', async () => {
      await http
        .post('/items')
        .send({ items: [MILK, { ...GREEN_ONION, expiresOn: '2026-13-01' }] })
        .expect(400);

      const res = await http.get('/items').expect(200);
      expect(res.body.items).toEqual([]);
    });

    it.each([
      ['빈 목록', { items: [] }],
      ['이름 공백', { items: [{ ...MILK, name: '   ' }] }],
      ['수량 0', { items: [{ ...MILK, quantity: 0 }] }],
      ['없는 카테고리', { items: [{ ...MILK, category: 'snack' }] }],
    ])('%s → 400', async (_, body) => {
      await http.post('/items').send(body).expect(400);
    });
  });

  describe('GET /items', () => {
    it('있는 재료를 유통기한이 가까운 순으로 돌려준다', async () => {
      await create(MILK, GREEN_ONION);

      const res = await http.get('/items').expect(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        '대파', // 11-17
        '우유', // 11-20
      ]);
    });

    it('카테고리와 검색어로 거른다 (상품명도 찾는다)', async () => {
      await create(MILK, GREEN_ONION);

      const byCategory = await http.get('/items?category=dairy').expect(200);
      expect(byCategory.body.items).toHaveLength(1);

      const byProduct = await http
        .get(`/items?q=${encodeURIComponent('서울')}`)
        .expect(200);
      expect(byProduct.body.items[0].name).toBe('우유');

      // %는 와일드카드가 아니라 글자로 찾는다
      const wildcard = await http.get('/items?q=%25').expect(200);
      expect(wildcard.body.items).toEqual([]);
    });
  });

  describe('PATCH /items/:id', () => {
    it('유통기한을 고치면 출처가 user로 바뀐다', async () => {
      const [onion] = await create(GREEN_ONION);

      const res = await http
        .patch(`/items/${onion.id}`)
        .send({ expiresOn: '2026-11-25', storage: 'freezer' })
        .expect(200);

      expect(res.body).toMatchObject({
        expiresOn: '2026-11-25',
        expirySource: 'user',
        storage: 'freezer',
      });
    });

    it('바꿀 값이 없으면 400, 없는 재료는 404, 잘못된 id는 400', async () => {
      const [onion] = await create(GREEN_ONION);
      await http.patch(`/items/${onion.id}`).send({}).expect(400);
      await http
        .patch(`/items/${NO_SUCH_ID}`)
        .send({ quantity: 3 })
        .expect(404);
      await http.patch('/items/not-a-uuid').send({ quantity: 3 }).expect(400);
    });
  });

  describe('먹었어요 / 버렸어요', () => {
    it('1개씩 먹다가 0개가 되면 다 먹은 것으로 바뀐다', async () => {
      const [milk] = await create(MILK); // 2팩

      const first = await http
        .post(`/items/${milk.id}/consume`)
        .send({ amount: 1 })
        .expect(200);
      expect(first.body).toMatchObject({ quantity: 1, status: 'active' });

      const second = await http
        .post(`/items/${milk.id}/consume`)
        .send({ amount: 1 })
        .expect(200);
      expect(second.body).toMatchObject({ quantity: 0, status: 'consumed' });
      expect(second.body.finishedAt).not.toBeNull();
    });

    it('수량 없이 보내면 전부 먹은 것이고, 다 먹은 재료는 목록에서 빠져 기록으로 간다', async () => {
      const [milk] = await create(MILK);

      await http.post(`/items/${milk.id}/consume`).expect(200);

      const active = await http.get('/items').expect(200);
      expect(active.body.items).toEqual([]);
      const history = await http.get('/items?status=consumed').expect(200);
      expect(history.body.items).toHaveLength(1);
    });

    it('이미 끝난 재료는 다시 먹거나 고칠 수 없다 (409)', async () => {
      const [milk] = await create(MILK);
      await http.post(`/items/${milk.id}/consume`).expect(200);

      await http.post(`/items/${milk.id}/consume`).expect(409);
      await http.post(`/items/${milk.id}/discard`).expect(409);
      await http.patch(`/items/${milk.id}`).send({ quantity: 1 }).expect(409);
    });

    // 요청 두 개를 동시에 보내는 것만으로는 실제로 겹치지 않아서 잠금이 없어도 통과했다 (직접 확인).
    // 그래서 테스트가 행을 먼저 잡아 "다른 요청이 처리 중"인 상황을 확실하게 만든다.
    it('다른 요청이 처리 중이면 기다렸다가 최신 수량으로 처리한다 (행 잠금)', async () => {
      const [milk] = await create(MILK); // 2팩
      const other = app.get(DataSource).createQueryRunner();
      await other.connect();
      await other.startTransaction();
      // 다른 요청이 행을 잡고 1팩을 먹은 상황 (아직 커밋 전)
      await other.query(
        'SELECT 1 FROM inventory_items WHERE id = $1 FOR UPDATE',
        [milk.id],
      );
      await other.query(
        'UPDATE inventory_items SET quantity = 1 WHERE id = $1',
        [milk.id],
      );

      let finished = false;
      const pending = http
        .post(`/items/${milk.id}/consume`)
        .send({ amount: 1 })
        .then((res) => {
          finished = true;
          return res;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(finished).toBe(false); // 잠금이 풀릴 때까지 기다린다

      await other.commitTransaction();
      await other.release();

      // 잠금이 없으면 커밋 전 값(2)에서 빼서 1이 남는다 — 먹은 기록 하나가 사라진다
      const res = await pending;
      expect(res.body).toMatchObject({ quantity: 0, status: 'consumed' });
    });

    it('버리면 버린 개수를 그대로 남긴다', async () => {
      const [milk] = await create(MILK);

      const res = await http.post(`/items/${milk.id}/discard`).expect(200);
      expect(res.body).toMatchObject({ status: 'discarded', quantity: 2 });
    });
  });

  describe('DELETE /items/:id', () => {
    it('잘못 등록한 재료를 지운다', async () => {
      const [milk] = await create(MILK);

      await http.delete(`/items/${milk.id}`).expect(204);
      await http.delete(`/items/${milk.id}`).expect(404);
    });
  });

  it('DB 제약이 앱 검증을 빠져나간 값도 막는다', async () => {
    const db = app.get(DataSource);
    await expect(
      db.query(
        `INSERT INTO inventory_items (name, category, emoji, quantity, unit, storage, expires_on, expiry_source, source)
         VALUES ('우유', 'snack', '🥛', 1, '팩', 'fridge', '2026-11-20', 'label', 'photo')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `INSERT INTO inventory_items (name, category, emoji, quantity, unit, storage, expires_on, expiry_source, source)
         VALUES ('우유', 'dairy', '🥛', 0, '팩', 'fridge', '2026-11-20', 'label', 'photo')`,
      ),
    ).rejects.toThrow(/inventory_items_active_check/);
  });
});
