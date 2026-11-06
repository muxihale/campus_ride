# Маршруты Swagger — 06.5

Получено 6 ноября 2026 года из GET /api/docs-json работающего API. Базовый префикс включён в пути. Коды ниже — документированные ответы OpenAPI; guards и общая валидация могут дополнительно возвращать ошибки доступа и параметров. Это перечень, а не замена интерактивного Swagger и подробного [контракта](api.md).

| Метод  | Путь                              | Документированные коды                 |
| ------ | --------------------------------- | -------------------------------------- |
| GET    | `/api/admin/activity`             | 200, 400, 401, 403, 503                |
| GET    | `/api/admin/reviews`              | 200, 400, 401, 403, 503                |
| POST   | `/api/admin/reviews/{id}/hide`    | 200, 400, 401, 403, 404, 503           |
| POST   | `/api/admin/reviews/{id}/restore` | 200, 400, 401, 403, 404, 503           |
| GET    | `/api/admin/users`                | 200, 400, 401, 403, 503                |
| POST   | `/api/admin/users/{id}/block`     | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/admin/users/{id}/unblock`   | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/auth/login`                 | 200, 400, 401, 403, 429                |
| POST   | `/api/auth/logout`                | 204, 403                               |
| GET    | `/api/auth/me`                    | 200, 401                               |
| POST   | `/api/auth/register`              | 201, 400, 403, 409, 429                |
| POST   | `/api/bookings/{id}/cancel`       | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/bookings/{id}/confirm`      | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/bookings/{id}/reject`       | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/bookings/{id}/reviews`      | 201, 400, 401, 403, 404, 409, 503      |
| GET    | `/api/campuses`                   | 200, 400, 503                          |
| GET    | `/api/districts`                  | 200, 400, 503                          |
| GET    | `/api/health`                     | 200                                    |
| GET    | `/api/health/ready`               | 200, 503                               |
| GET    | `/api/locations`                  | 200, 400, 503                          |
| GET    | `/api/me`                         | 200, 401, 503                          |
| PATCH  | `/api/me`                         | 200, 400, 401, 403, 503                |
| GET    | `/api/me/activity`                | 200, 400, 401, 403, 503                |
| GET    | `/api/me/bookings`                | 200, 400, 401, 403, 503                |
| POST   | `/api/me/driver-profile`          | 201, 400, 401, 403, 409, 503           |
| GET    | `/api/me/driver-statistics`       | 200, 400, 401, 403, 503                |
| GET    | `/api/me/reviews`                 | 200, 400, 401, 403, 503                |
| GET    | `/api/me/ride-bookings`           | 200, 400, 401, 403, 503                |
| GET    | `/api/me/rides`                   | 200, 400, 401, 403, 503                |
| GET    | `/api/me/rides/{id}`              | 200, 400, 401, 403, 404, 503           |
| GET    | `/api/me/vehicles`                | 200, 400, 401, 403, 503                |
| POST   | `/api/me/vehicles`                | 201, 400, 401, 403, 409, 503           |
| PATCH  | `/api/me/vehicles/{id}`           | 200, 400, 401, 403, 404, 409, 503      |
| GET    | `/api/notifications`              | 200, 400, 401, 403, 503                |
| PATCH  | `/api/notifications/{id}/read`    | 200, 400, 401, 403, 404, 503           |
| POST   | `/api/rides`                      | 201, 400, 401, 403, 404, 503           |
| GET    | `/api/rides`                      | 200, 400, 503                          |
| PATCH  | `/api/rides/{id}`                 | 200, 400, 401, 403, 404, 409, 503      |
| DELETE | `/api/rides/{id}`                 | 204, 400, 401, 403, 404, 409, 503      |
| GET    | `/api/rides/{id}`                 | 200, 400, 404, 503                     |
| POST   | `/api/rides/{id}/bookings`        | 200, 201, 400, 401, 403, 404, 409, 503 |
| POST   | `/api/rides/{id}/cancel`          | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/rides/{id}/complete`        | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/rides/{id}/publish`         | 200, 400, 401, 403, 404, 409, 503      |
| POST   | `/api/rides/{id}/start`           | 200, 400, 401, 403, 404, 409, 503      |
| GET    | `/api/users/{id}/ratings`         | 200, 400, 404, 503                     |
| GET    | `/api/users/{id}/reviews`         | 200, 400, 404, 503                     |
