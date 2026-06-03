# Сайт расписания ВГАУ

Единый сайт расписания на базе Google Drive ВГАУ.

Разделы:

- `/students/` - расписание студентов и просмотр файлов Google Drive
- `/teachers/` - расписание по преподавателям
- `/rooms/` - расписание по аудиториям

Главная страница `/` автоматически открывает раздел студентов.

## Локальный запуск

```powershell
pip install -r requirements.txt
python public_server.py
```

По умолчанию сайт откроется на:

```text
http://127.0.0.1:8000/
```

Можно указать порт:

```powershell
python public_server.py 8080
```

## Публикация

Подробная инструкция по Render, Railway и VPS находится в файле [DEPLOY.md](DEPLOY.md).

Для Render уже подготовлен `render.yaml`.
Для Docker/VPS уже подготовлен `Dockerfile`.

## Структура

```text
public_server.py                 общий сервер
vsau_schedule_site/              раздел студентов
vsau_teacher_schedule_site/      раздел преподавателей
vsau_room_schedule_site/         раздел аудиторий
requirements.txt                 зависимости Python
render.yaml                      конфигурация Render
Dockerfile                       контейнер для VPS/Railway/Docker
```

## Источник расписания

Сайт читает расписание из Google Drive:

```text
https://drive.google.com/drive/folders/1Gn8OEzbtxFBusuCnPCTBjQoK1AWKiVN2
```
