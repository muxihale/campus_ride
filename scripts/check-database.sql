-- Проверка ограничений на настоящем PostgreSQL. Все данные откатываются.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  driver_id uuid := gen_random_uuid();
  passenger_id uuid := gen_random_uuid();
  district_id uuid := gen_random_uuid();
  origin_id uuid := gen_random_uuid();
  destination_id uuid := gen_random_uuid();
  vehicle_id uuid := gen_random_uuid();
  ride_id uuid := gen_random_uuid();
  booking_id uuid := gen_random_uuid();
  next_booking_id uuid := gen_random_uuid();
  payment_id uuid := gen_random_uuid();
  review_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO "User" ("id", "email", "passwordHash", "fullName", "updatedAt") VALUES
    (driver_id, driver_id || '@campusride.test', 'test-only', 'Тестовый водитель', now()),
    (passenger_id, passenger_id || '@campusride.test', 'test-only', 'Тестовый пассажир', now());
  INSERT INTO "UserRole" ("userId", "role") VALUES (driver_id, 'DRIVER'), (passenger_id, 'PASSENGER');
  INSERT INTO "DriverProfile" ("userId") VALUES (driver_id);
  INSERT INTO "District" ("id", "name") VALUES (district_id, 'Проверка ' || district_id);
  INSERT INTO "Location" ("id", "name", "address", "districtId") VALUES
    (origin_id, 'Тестовая точка отправления', 'Тестовый адрес', district_id),
    (destination_id, 'Тестовая точка назначения', 'Другой тестовый адрес', district_id);
  INSERT INTO "Vehicle" ("id", "driverId", "make", "model", "color", "registrationNumber", "passengerSeats")
    VALUES (vehicle_id, driver_id, 'Тест', 'Тест', 'Серый', vehicle_id::text, 3);
  INSERT INTO "Ride" ("id", "driverId", "vehicleId", "originId", "destinationId", "departureAt", "seatsTotal", "priceKopecks", "status", "updatedAt")
    VALUES (ride_id, driver_id, vehicle_id, origin_id, destination_id, now() + interval '1 day', 1, 15000, 'PUBLISHED', now());
  INSERT INTO "Booking" ("id", "rideId", "passengerId", "requestKey", "seats", "unitPriceKopecks", "updatedAt")
    VALUES (booking_id, ride_id, passenger_id, gen_random_uuid(), 1, 15000, now());

  BEGIN
    INSERT INTO "Booking" ("id", "rideId", "passengerId", "requestKey", "seats", "unitPriceKopecks", "updatedAt")
      VALUES (next_booking_id, ride_id, passenger_id, gen_random_uuid(), 1, 15000, now());
    RAISE EXCEPTION 'Не запрещены две активные заявки одного пассажира';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE "Booking" SET "status" = 'CANCELLED' WHERE "id" = booking_id;
  INSERT INTO "Booking" ("id", "rideId", "passengerId", "requestKey", "seats", "unitPriceKopecks", "updatedAt")
    VALUES (next_booking_id, ride_id, passenger_id, gen_random_uuid(), 1, 15000, now());

  BEGIN
    UPDATE "Booking" SET "seats" = 0 WHERE "id" = next_booking_id;
    RAISE EXCEPTION 'Разрешено нулевое количество мест';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "Ride" SET "priceKopecks" = -1 WHERE "id" = ride_id;
    RAISE EXCEPTION 'Разрешена отрицательная цена';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "Ride" SET "destinationId" = origin_id WHERE "id" = ride_id;
    RAISE EXCEPTION 'Разрешены одинаковые начало и конец маршрута';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "Ride" SET "originId" = gen_random_uuid() WHERE "id" = ride_id;
    RAISE EXCEPTION 'Не проверяется внешний ключ точки маршрута';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO "Payment" ("id", "bookingId", "amountKopecks", "updatedAt")
    VALUES (payment_id, next_booking_id, 15000, now());
  BEGIN
    UPDATE "Payment" SET "isDemo" = false WHERE "id" = payment_id;
    RAISE EXCEPTION 'Разрешён платёж вне демо-режима';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "Payment" ("id", "bookingId", "amountKopecks", "updatedAt")
      VALUES (gen_random_uuid(), next_booking_id, 15000, now());
    RAISE EXCEPTION 'Разрешён второй платёж на одно бронирование';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE "Booking" SET "status" = 'COMPLETED' WHERE "id" = next_booking_id;
  UPDATE "Ride" SET "status" = 'COMPLETED' WHERE "id" = ride_id;
  INSERT INTO "Review" ("id", "bookingId", "authorId", "recipientId", "rating", "comment")
    VALUES (review_id, next_booking_id, passenger_id, driver_id, 5, 'Поездка прошла хорошо');
  INSERT INTO "Review" ("id", "bookingId", "authorId", "recipientId", "rating", "comment")
    VALUES (gen_random_uuid(), next_booking_id, driver_id, passenger_id, 5, 'Пассажир пришёл вовремя');
  BEGIN
    UPDATE "Review" SET "rating" = 6 WHERE "id" = review_id;
    RAISE EXCEPTION 'Разрешена оценка вне диапазона 1–5';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "Review" SET "recipientId" = passenger_id WHERE "id" = review_id;
    RAISE EXCEPTION 'Разрешён отзыв самому себе';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE "Review" SET "comment" = '   ' WHERE "id" = review_id;
    RAISE EXCEPTION 'Разрешён пустой отзыв';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "Review" ("id", "bookingId", "authorId", "recipientId", "rating", "comment")
      VALUES (gen_random_uuid(), next_booking_id, passenger_id, driver_id, 4, 'Повторный отзыв');
    RAISE EXCEPTION 'Разрешён повторный отзыв того же автора';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'Проверки БД пройдены: связи, повторное бронирование, места, цены, маршрут, демо-платежи и двусторонние отзывы.';
END $$;

ROLLBACK;
