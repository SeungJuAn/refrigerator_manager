import { createGoogle } from '@ai-sdk/google';
import { Logger, Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiModule } from '@nestjs/ai';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import {
  DEFAULT_DATABASE_URL,
  databaseOptions,
} from './database/database.options.js';
import { ItemsModule } from './items/items.module.js';
import { RecognitionModule } from './recognition/recognition.module.js';

// 무료 등급이 있는 Flash 모델. .env의 GEMINI_MODEL로 바꿀 수 있다.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        databaseOptions(
          config.get<string>('DATABASE_URL', DEFAULT_DATABASE_URL),
        ),
    }),
    AiModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // 키가 없어도 서버는 뜬다 (다른 API 개발용). 사진 인식 요청만 503으로 실패한다.
        const apiKey = config.get<string>('GEMINI_API_KEY');
        if (!apiKey) {
          new Logger('AiModule').warn(
            'GEMINI_API_KEY가 없습니다. server/.env를 확인하세요. 사진 인식이 실패합니다.',
          );
        }
        const google = createGoogle({ apiKey });
        return {
          models: {
            default: google(
              config.get<string>('GEMINI_MODEL', DEFAULT_GEMINI_MODEL),
            ),
          },
          defaults: { timeout: '60s', retry: { attempts: 2 } },
        };
      },
    }),
    RecognitionModule,
    ItemsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // @Body({ schema }) 같은 Zod 스키마 검증. 여기 두면 테스트에서 만든 앱에도 똑같이 걸린다 (main.ts는 테스트에서 안 돈다)
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class AppModule {}
