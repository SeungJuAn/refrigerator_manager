import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AiModule } from '@nestjs/ai';
import { FakeModel, providerError } from '@nestjs/ai/testing';
import {
  RecognitionService,
  normalizeDate,
  normalizeEmoji,
  toBox,
} from './recognition.service.js';
import type { ModelItem, RecognizedItem } from './recognition.schema.js';

const PHOTO = { data: Buffer.from('fake-image'), mediaType: 'image/jpeg' };

/** 모델이 답하는 형태 */
function modelItem(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    name: '우유',
    description: null,
    productName: '서울우유 1L',
    emoji: '🥛',
    category: 'dairy',
    quantity: 1,
    unit: '팩',
    storage: 'fridge',
    expiryDate: '2026-11-20',
    shelfLifeDays: 10,
    confidence: 'high',
    boxes: [[100, 200, 500, 400]],
    ...overrides,
  };
}

/** API가 돌려주는 형태 (modelItem()을 정리한 결과) */
function apiItem(overrides: Partial<RecognizedItem> = {}): RecognizedItem {
  return {
    ...modelItem(),
    boxes: [{ x: 0.2, y: 0.1, width: 0.2, height: 0.4 }],
    ...overrides,
  } as RecognizedItem;
}

async function serviceWith(model: FakeModel): Promise<RecognitionService> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AiModule.forRoot({
        models: { default: model },
        defaults: { retry: false },
      }),
    ],
    providers: [RecognitionService],
  }).compile();
  return moduleRef.get(RecognitionService);
}

async function recognizeWith(...items: ModelItem[]) {
  const service = await serviceWith(new FakeModel([{ object: { items } }]));
  return service.recognize(PHOTO);
}

describe('RecognitionService', () => {
  it('모델 답을 API 형태로 바꿔 돌려준다 (박스는 0~1 비율)', async () => {
    await expect(recognizeWith(modelItem())).resolves.toEqual({
      items: [apiItem()],
    });
  });

  it('지시문과 함께 사진을 이미지로 보낸다', async () => {
    const model = new FakeModel([{ object: { items: [] } }]);
    const service = await serviceWith(model);

    await service.recognize(PHOTO);

    const call = model.lastCall!;
    expect(call.instructions).toContain('식재료 인식기');
    const userContent = call.options.prompt.find(
      (m) => m.role === 'user',
    )?.content;
    expect(userContent).toContainEqual(
      expect.objectContaining({ type: 'file', mediaType: 'image/jpeg' }),
    );
  });

  it('뭔지 모르는 물체는 이름 null로 남기고 확인 필요로 표시한다', async () => {
    const result = await recognizeWith(
      modelItem({
        name: null,
        description: '뚜껑 있는 불투명 플라스틱 통',
        productName: null,
        emoji: null,
        category: 'other',
        confidence: 'high',
      }),
    );

    expect(result.items).toEqual([
      apiItem({
        name: null,
        description: '뚜껑 있는 불투명 플라스틱 통',
        productName: null,
        emoji: '📦', // 기타의 기본 이모지
        category: 'other',
        confidence: 'low',
      }),
    ]);
  });

  it('이름을 알면 설명은 버린다', async () => {
    const result = await recognizeWith(
      modelItem({ description: '하얀 우유팩' }),
    );
    expect(result.items[0].description).toBeNull();
  });

  it('이름도 위치도 설명도 없는 항목은 뺀다', async () => {
    const result = await recognizeWith(
      modelItem(),
      modelItem({ name: '  ', description: null, boxes: [] }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('모델 답의 어긋난 값을 정리한다', async () => {
    const result = await recognizeWith(
      modelItem({
        name: ' 고추장 ',
        productName: '  ',
        emoji: '고추장',
        category: 'sauce',
        quantity: 0,
        unit: '',
        expiryDate: '2026.11.31',
        shelfLifeDays: 0.4,
        boxes: [
          [100, 200, 500, 400],
          [1, 2, 3],
        ],
      }),
    );

    expect(result.items).toEqual([
      apiItem({
        name: '고추장',
        productName: null,
        emoji: '🧂', // 글자는 이모지가 아니라서 소스·양념 기본값
        category: 'sauce',
        quantity: 1,
        unit: '개',
        expiryDate: null, // 11월 31일은 없다
        shelfLifeDays: 1,
        // 형식이 틀린 박스 [1, 2, 3]은 버린다
      }),
    ]);
  });

  it('박스가 개수보다 많으면 박스 수를 개수로 쓴다', async () => {
    const result = await recognizeWith(
      modelItem({
        quantity: 1,
        boxes: [
          [0, 0, 100, 100],
          [0, 200, 100, 300],
          [0, 400, 100, 500],
        ],
      }),
    );
    expect(result.items[0].quantity).toBe(3);
  });

  it('스키마에 안 맞는 답이면 502', async () => {
    const service = await serviceWith(new FakeModel(['이건 JSON이 아니다']));

    await expect(service.recognize(PHOTO)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('Gemini 호출이 실패하면 503', async () => {
    const service = await serviceWith(
      new FakeModel([providerError(429, { message: 'quota exceeded' })]),
    );

    await expect(service.recognize(PHOTO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('toBox', () => {
  it('[ymin, xmin, ymax, xmax] 0~1000 → x, y, width, height 0~1', () => {
    expect(toBox([100, 200, 500, 400])).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.2,
      height: 0.4,
    });
  });

  it('뒤집힌 좌표는 바로잡고, 범위를 넘으면 자른다', () => {
    expect(toBox([500, 400, 100, 200])).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.2,
      height: 0.4,
    });
    expect(toBox([-50, 900, 300, 1200])).toEqual({
      x: 0.9,
      y: 0,
      width: 0.1,
      height: 0.3,
    });
  });

  it.each([
    [[1, 2, 3]],
    [[1, 2, 3, 4, 5]],
    [[100, 100, 100, 500]],
    [[0, 0, NaN, 10]],
  ])('%j → null', (raw) => {
    expect(toBox(raw)).toBeNull();
  });
});

describe('normalizeEmoji', () => {
  it.each(['🍌', '🥛', ' 🧑‍🍳 ', '❤️'])('%s는 이모지', (value) => {
    expect(normalizeEmoji(value)).toBe(value.trim());
  });

  it.each([null, '', '바나나', 'banana 🍌', '1', '🍌'.repeat(10)])(
    '%s → null',
    (value) => {
      expect(normalizeEmoji(value)).toBeNull();
    },
  );
});

describe('normalizeDate', () => {
  it.each([
    ['2026-11-20', '2026-11-20'],
    ['2026.11.20', '2026-11-20'],
    ['2026/1/5', '2026-01-05'],
    ['20261120', '2026-11-20'],
    [' 2026-11-20 ', '2026-11-20'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });

  it.each([null, '', '26.11.20', '2026-02-30', '2026-13-01', '내일까지'])(
    '%s → null',
    (input) => {
      expect(normalizeDate(input)).toBeNull();
    },
  );
});
