import * as z from 'zod';
import { CATEGORY_KEYS, STORAGES } from '../common/food.js';

// 모델(Gemini)이 답하는 형태. 이 스키마의 JSON Schema가 그대로 모델에 전달된다.
// 숫자 범위·날짜 형식·배열 길이 같은 제약은 일부러 넣지 않았다: 모델이 조금만 어긋나도 답 전체가 거부되기 때문에,
// 느슨하게 받고 recognition.service.ts에서 정리한다.
export const ModelItemSchema = z.object({
  name: z
    .string()
    .nullable()
    .describe(
      '요리에 쓰는 재료 이름. 짧게. 예: "서울우유 1L" → "우유", "해찬들 태양초 고추장" → "고추장". 불투명한 통·상자·봉지라 뭔지 알 수 없으면 null',
    ),
  description: z
    .string()
    .nullable()
    .describe(
      'name이 null일 때만: 사용자가 알아볼 수 있게 겉모습을 짧게. 예: "뚜껑 있는 불투명 플라스틱 통". name을 알면 null',
    ),
  productName: z
    .string()
    .nullable()
    .describe(
      '포장지에 보이는 상품명 그대로. 포장이 없거나 글자가 안 보이면 null',
    ),
  emoji: z
    .string()
    .nullable()
    .describe('이 재료를 나타내는 이모지 한 개. 마땅한 게 없으면 null'),
  category: z
    .enum(CATEGORY_KEYS)
    .describe(
      'vegetable=채소, fruit=과일, meat_egg=육류·계란, seafood=수산물, dairy=유제품, tofu_processed=두부·햄·어묵 같은 가공품, side_dish=반찬·김치, sauce=소스·양념·장류, beverage=음료, ready_meal=냉동식품·즉석식품·라면, other=그 밖 또는 모름',
    ),
  quantity: z.number().describe('개수. 같은 물건이 여러 개면 합친 개수'),
  unit: z.string().describe('개수 단위. 예: 개, 팩, 병, 봉, 캔, 단, 모'),
  storage: z
    .enum(STORAGES)
    .describe('권장 보관 위치. fridge=냉장, freezer=냉동, pantry=실온'),
  expiryDate: z
    .string()
    .nullable()
    .describe(
      '포장지에 찍힌 유통기한·소비기한을 읽었을 때만 YYYY-MM-DD. 안 보이면 null. 추측하지 않는다',
    ),
  shelfLifeDays: z
    .number()
    .describe('storage에 보관했을 때 개봉 전 기준으로 보통 먹을 수 있는 일수'),
  confidence: z
    .enum(['high', 'low'])
    .describe(
      '이 항목을 확신하면 high. 가려졌거나 흐리거나 종류가 애매하면 low',
    ),
  boxes: z
    .array(z.array(z.number()))
    .describe(
      '사진 속 위치. 물건 하나당 [ymin, xmin, ymax, xmax], 사진 크기에 대한 0~1000 비율. 같은 물건이 여러 개 보이면 하나씩',
    ),
});

export const ModelResultSchema = z.object({
  items: z
    .array(ModelItemSchema)
    .describe('사진 속 식품 목록. 식품이 없으면 빈 배열'),
});

export type ModelItem = z.infer<typeof ModelItemSchema>;

/** 사진 속 위치. 사진 너비·높이에 대한 0~1 비율, 왼쪽 위가 (0, 0). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** API가 돌려주는 항목. 모델 답을 정리한 것이다. */
export interface RecognizedItem extends Omit<ModelItem, 'emoji' | 'boxes'> {
  /** 모델이 못 고르면 카테고리 기본 이모지 */
  emoji: string;
  boxes: Box[];
}

export interface RecognitionResult {
  items: RecognizedItem[];
}
