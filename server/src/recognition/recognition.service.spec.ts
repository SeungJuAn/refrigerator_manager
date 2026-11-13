import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AiModule } from '@nestjs/ai';
import { FakeModel, providerError } from '@nestjs/ai/testing';
import { RecognitionService, normalizeDate } from './recognition.service.js';
import type { RecognizedItem } from './recognition.schema.js';

const PHOTO = { data: Buffer.from('fake-image'), mediaType: 'image/jpeg' };

function item(overrides: Partial<RecognizedItem> = {}): RecognizedItem {
  return {
    name: '우유',
    productName: '서울우유 1L',
    quantity: 1,
    unit: '팩',
    storage: 'fridge',
    expiryDate: '2026-11-20',
    shelfLifeDays: 10,
    confidence: 'high',
    ...overrides,
  };
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

describe('RecognitionService', () => {
  it('모델이 돌려준 목록을 그대로 돌려준다', async () => {
    const model = new FakeModel([{ object: { items: [item()] } }]);
    const service = await serviceWith(model);

    await expect(service.recognize(PHOTO)).resolves.toEqual({
      items: [item()],
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

  it('모델 답의 어긋난 값을 정리한다', async () => {
    const model = new FakeModel([
      {
        object: {
          items: [
            item({
              name: ' 고추장 ',
              productName: '  ',
              quantity: 0,
              unit: '',
              expiryDate: '2026.11.31',
              shelfLifeDays: 0.4,
            }),
            item({ name: '   ' }),
          ],
        },
      },
    ]);
    const service = await serviceWith(model);

    const result = await service.recognize(PHOTO);

    expect(result.items).toEqual([
      item({
        name: '고추장',
        productName: null,
        quantity: 1,
        unit: '개',
        expiryDate: null, // 11월 31일은 없다
        shelfLifeDays: 1,
      }),
    ]);
  });

  it('스키마에 안 맞는 답이면 502', async () => {
    const model = new FakeModel(['이건 JSON이 아니다']);
    const service = await serviceWith(model);

    await expect(service.recognize(PHOTO)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('Gemini 호출이 실패하면 503', async () => {
    const model = new FakeModel([
      providerError(429, { message: 'quota exceeded' }),
    ]);
    const service = await serviceWith(model);

    await expect(service.recognize(PHOTO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
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
