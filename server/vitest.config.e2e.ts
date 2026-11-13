import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // 실제 PostgreSQL이 필요하다: 저장소 루트에서 `docker compose up -d`
    // 개발용 DB(fridge)가 아니라 테스트용 DB(fridge_test)를 쓴다. 테스트가 테이블을 비우기 때문이다.
    env: {
      DATABASE_URL: 'postgres://fridge:fridge@localhost:5433/fridge_test',
    },
    // 파일마다 앱을 띄우며 같은 DB에 마이그레이션을 돌리므로 동시에 돌리지 않는다
    fileParallelism: false,
  },
});
