import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FakeModel, overrideModels } from '@nestjs/ai/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { MAX_PHOTO_BYTES } from './../src/recognition/recognition.controller.js';

// 1×1 PNG. 파일 형식 검사가 내용(매직 넘버)을 보기 때문에 진짜 이미지여야 한다.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// 모델(Gemini)이 답하는 형태
const MILK_FROM_MODEL = {
  name: '우유',
  description: null,
  productName: '서울우유 1L',
  emoji: '🥛',
  category: 'dairy',
  quantity: 2,
  unit: '팩',
  storage: 'fridge',
  expiryDate: '2026-11-20',
  shelfLifeDays: 10,
  confidence: 'high',
  boxes: [
    [100, 100, 600, 300],
    [100, 350, 600, 550],
  ],
};

// API가 돌려주는 형태: 박스가 0~1 비율의 x, y, width, height로 바뀐다
const MILK = {
  ...MILK_FROM_MODEL,
  boxes: [
    { x: 0.1, y: 0.1, width: 0.2, height: 0.5 },
    { x: 0.35, y: 0.1, width: 0.2, height: 0.5 },
  ],
};

describe('POST /recognition (e2e)', () => {
  let app: INestApplication<App>;
  let model: FakeModel;

  beforeEach(async () => {
    model = new FakeModel([{ object: { items: [MILK_FROM_MODEL] } }]);
    // 실제 Gemini 대신 FakeModel이 답한다. 키가 없어도 돈다.
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AppModule] }),
      { default: model },
    ).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('사진을 올리면 식품 목록을 돌려준다', async () => {
    const res = await request(app.getHttpServer())
      .post('/recognition')
      .attach('photo', PNG, {
        filename: 'groceries.png',
        contentType: 'image/png',
      })
      .expect(200);

    expect(res.body).toEqual({ items: [MILK] });
    expect(model.calls).toHaveLength(1);
  });

  it('사진이 없으면 400', async () => {
    await request(app.getHttpServer()).post('/recognition').expect(400);
    expect(model.calls).toHaveLength(0);
  });

  it('이미지가 아니면 400 (확장자·MIME만 바꿔도 내용으로 걸러진다)', async () => {
    await request(app.getHttpServer())
      .post('/recognition')
      .attach('photo', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(model.calls).toHaveLength(0);
  });

  it('10MB를 넘으면 413', async () => {
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    await request(app.getHttpServer())
      .post('/recognition')
      .attach('photo', tooBig, {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(model.calls).toHaveLength(0);
  });
});
