-- 컨테이너를 처음 만들 때 한 번만 실행된다 (볼륨이 비어 있을 때).
-- e2e 테스트는 이 DB를 쓴다. 테이블을 비우면서 돌기 때문에 개발용 DB(fridge)와 나눈다.
CREATE DATABASE fridge_test OWNER fridge;
