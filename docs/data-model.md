# 재고 데이터 모델

> 11/13 구현 완료: `server/src/items/`, 마이그레이션 `server/src/database/migrations/`. 아래 "결정할 것"은 모두 정했다.

[기능 목록](features.md)의 3번(재고 목록)과 1번 마지막 단계("선택한 n개 저장")를 받쳐 주는 모델.

## 기본 방향

- **서버 DB(PostgreSQL)에 저장한다.** 로컬은 Docker로 띄운다(`compose.yaml`, 127.0.0.1:5433). 알림은 폰이 이 목록을 받아서 폰 안에서 예약한다.
- **v1은 사용자 구분이 없다.** 내 PC·내 네트워크에서만 띄우는 서버라 재고 목록이 하나다.
  인터넷에 올리기 전에 로그인(또는 기기별 구분)을 반드시 넣는다 — 지금은 아무나 접근하면 다 보인다.
- **한 행 = 한 번에 산 묶음.** 같은 우유라도 산 날·유통기한이 다르면 따로 둔다. 먼저 상하는 것부터 보여 줘야 하기 때문이다.
- **다 먹거나 버린 것도 지우지 않고 상태만 바꾼다.** 나중에 "이번 달 버린 음식", "아낀 비용" 같은 통계를 내려면 기록이 있어야 한다.

## 테이블: `inventory_items`

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | uuid | O | |
| `name` | text | O | 재료 이름. 인식에서 `?`였던 건 사용자가 적은 이름 |
| `product_name` | text | | 포장지 상품명 ("서울우유 1L") |
| `category` | enum | O | `vegetable` … `other` 11개 ([결정 4](features.md)) |
| `emoji` | text | O | |
| `quantity` | integer | O | 1 이상. 남은 개수 |
| `unit` | text | O | 개, 팩, 병 … |
| `storage` | enum | O | `fridge` / `freezer` / `pantry` |
| `expires_on` | date | O | 유통기한. 시간 없이 날짜만 |
| `expiry_source` | enum | O | `label` 포장에서 읽음 / `estimated` 보관 일수로 추정 / `user` 사용자가 직접 |
| `source` | enum | O | `photo` 사진 인식 / `manual` 직접 입력 |
| `status` | enum | O | `active` 있음 / `consumed` 다 먹음 / `discarded` 버림 |
| `finished_at` | timestamptz | | 다 먹거나 버린 때 |
| `created_at` | timestamptz | O | 등록한 때 |
| `updated_at` | timestamptz | O | |

인덱스: `(status, expires_on)` — 홈 화면이 "있는 것을 유통기한 순으로"를 가장 많이 부른다.

### 날짜 규칙

- `expires_on`은 **날짜만** 저장한다. D-day는 폰이 자기 시간대(한국)의 오늘과 비교해서 계산한다. 서버는 시간대 계산을 하지 않는다.
- 유통기한을 못 읽은 재료는 앱이 `오늘 + shelfLifeDays`로 채워서 보내고 `expiry_source = estimated`로 둔다. 화면에 "추정"으로 표시한다.

### 상태 흐름

```
           먹었어요 (1개)                      수량이 0이 되면
 active ──────────────→ active (quantity - 1) ──────────────→ consumed
   │
   ├── 다 먹었어요 ──────────────────────────────────────────→ consumed
   └── 버렸어요 ─────────────────────────────────────────────→ discarded
```

잘못 등록한 건 상태를 바꾸지 않고 행을 지운다 (통계에 섞이면 안 되니까).

## API (초안)

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/items` | 있는 재료 목록. 유통기한 순. `?category=`, `?q=` 검색 |
| `POST` | `/items` | 여러 개 한 번에 등록 (사진 결과 확인 화면, 직접 입력 둘 다) |
| `PATCH` | `/items/:id` | 이름·수량·보관 위치·유통기한 수정 |
| `POST` | `/items/:id/consume` | 먹었어요. `{ amount }` 없으면 전부 |
| `POST` | `/items/:id/discard` | 버렸어요 |
| `DELETE` | `/items/:id` | 잘못 등록한 것 지우기 |

"이미 있음" 표시([기능 1번](features.md))는 앱이 `GET /items`로 받은 목록과 인식 결과의 이름을 비교한다. 따로 API를 만들지 않는다.

## 정한 것 (11/13)

1. **ORM: TypeORM** — 엔티티·리포지토리·트랜잭션 개념이 Spring의 JPA와 거의 같다. (후보였던 Drizzle은 SQL에 더 가깝고 타입이 더 정확하다.)
2. **다 먹은 기록 남긴다** (`status`) — "이번 달 버린 음식", "아낀 비용" 같은 통계를 내려면 필요하다.
3. **"먹었어요"는 1개씩 줄이기 + 전부 둘 다** — 시안은 누르면 바로 사라지지만, 계란 10개 중 2개만 먹는 경우가 많다.

## 구현 메모

- 테이블은 `synchronize`가 아니라 직접 쓴 SQL 마이그레이션으로 만든다. 서버가 뜰 때 안 돌린 마이그레이션을 적용한다(`migrationsRun`).
- 값 검사는 두 겹이다: API에서 Zod, DB에서 CHECK 제약 (카테고리·상태 목록, "있는 재료는 1개 이상이고 끝난 시각이 없다").
- 먹었어요·버렸어요·수정은 트랜잭션 안에서 행을 잠그고(`SELECT … FOR UPDATE`) 처리한다. 잠금이 없으면 두 요청이 같은 수량을 읽고 각자 빼서 먹은 기록 하나가 사라진다 — e2e 테스트가 이 상황을 직접 만들어 확인한다.
