import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiModelError,
  AiOutputError,
  AiService,
  describeModel,
} from '@nestjs/ai';
import {
  RECOGNITION_INSTRUCTIONS,
  RECOGNITION_REQUEST,
} from './recognition.prompt.js';
import { CATEGORY_EMOJI } from '../common/food.js';
import {
  ModelResultSchema,
  type Box,
  type ModelItem,
  type RecognitionResult,
  type RecognizedItem,
} from './recognition.schema.js';

export interface Photo {
  data: Buffer;
  /** 예: image/jpeg. 모르면 비워 둔다. */
  mediaType?: string;
}

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(private readonly ai: AiService) {}

  async recognize(photo: Photo): Promise<RecognitionResult> {
    try {
      const { object } = await this.ai.generateObject({
        label: 'recognize-groceries',
        schema: ModelResultSchema,
        instructions: RECOGNITION_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: RECOGNITION_REQUEST },
              // 'image'만 주면 AI SDK가 파일 내용으로 세부 형식(image/jpeg 등)을 알아낸다
              {
                type: 'file',
                data: photo.data,
                mediaType: photo.mediaType ?? 'image',
              },
            ],
          },
        ],
      });
      return {
        items: object.items.map(normalizeItem).filter(isWorthShowing),
      };
    } catch (error) {
      if (error instanceof AiOutputError) {
        this.logger.warn(
          `인식 결과가 스키마와 맞지 않음: ${error.text.slice(0, 300)}`,
        );
        throw new BadGatewayException(
          '사진 인식 결과를 해석하지 못했습니다. 다시 시도해 주세요.',
        );
      }
      if (error instanceof AiModelError) {
        // 원래 에러를 통째로 남기면 요청 본문(사진 base64)까지 찍힐 수 있어서 메시지만 남긴다.
        const attempts = error.attempts
          .map(
            (a) =>
              `${describeModel(a.model)} #${a.attempt}: ${errorMessage(a.error)}`,
          )
          .join(' | ');
        this.logger.error(`Gemini 호출 실패: ${attempts}`);
        throw new ServiceUnavailableException(
          '사진 인식을 지금 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      throw error;
    }
  }
}

function normalizeItem(item: ModelItem): RecognizedItem {
  const name = item.name?.trim() || null;
  const boxes = item.boxes.map(toBox).filter((box): box is Box => box !== null);
  return {
    ...item,
    name,
    // 이름을 알면 설명은 필요 없다 (앱은 이름이 없을 때만 설명을 보여 준다)
    description: name ? null : item.description?.trim() || null,
    productName: item.productName?.trim() || null,
    emoji: normalizeEmoji(item.emoji) ?? CATEGORY_EMOJI[item.category],
    // 박스가 개수보다 많으면 개수를 적게 센 것이다. 반대(계란 한 판 = 박스 1, 6개)는 그대로 둔다
    quantity: Math.max(item.quantity > 0 ? item.quantity : 1, boxes.length),
    unit: item.unit.trim() || '개',
    expiryDate: normalizeDate(item.expiryDate),
    shelfLifeDays: Math.max(1, Math.round(item.shelfLifeDays)),
    // 뭔지 모르는 항목은 무조건 확인이 필요하다
    confidence: name ? item.confidence : 'low',
    boxes,
  };
}

/** 이름도, 위치도, 설명도 없으면 사용자가 뭔지 알 방법이 없어서 뺀다. */
function isWorthShowing(item: RecognizedItem): boolean {
  return (
    item.name !== null || item.boxes.length > 0 || item.description !== null
  );
}

/** Gemini의 [ymin, xmin, ymax, xmax] (0~1000) → { x, y, width, height } (0~1). 형식이 틀리거나 넓이가 0이면 null. */
export function toBox(raw: number[]): Box | null {
  if (raw.length !== 4 || !raw.every(Number.isFinite)) return null;
  const [y1, x1, y2, x2] = raw.map(
    (n) => Math.min(1000, Math.max(0, n)) / 1000,
  );
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (width === 0 || height === 0) return null;
  return {
    x: round4(Math.min(x1, x2)),
    y: round4(Math.min(y1, y2)),
    width: round4(width),
    height: round4(height),
  };
}

/** 그림 문자가 들어 있고 글자·숫자가 없는 짧은 문자열만 이모지로 인정한다. */
export function normalizeEmoji(value: string | null): string | null {
  const emoji = value?.trim();
  if (!emoji || emoji.length > 16) return null;
  if (!/\p{Extended_Pictographic}/u.test(emoji)) return null;
  if (/[\p{L}\p{N}]/u.test(emoji.replace(/\p{Extended_Pictographic}/gu, '')))
    return null;
  return emoji;
}

/** "2026-11-20", "2026.11.20", "2026/11/20", "20261120" → "2026-11-20". 실제 없는 날짜나 다른 형식이면 null. */
export function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
