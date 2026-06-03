# Загрузка проекта на GitHub

Проект уже подготовлен в папке:

```text
C:\Users\ioank\OneDrive\Документы\New project\vsau_public_deploy
```

## Вариант 1: через команды Git

1. Открыть PowerShell.

2. Перейти в папку проекта:

```powershell
cd "C:\Users\ioank\OneDrive\Документы\New project\vsau_public_deploy"
```

3. Создать пустой репозиторий на GitHub.

Например с названием:

```text
vsau-schedule-site
```

Не добавлять README, `.gitignore` и License на сайте GitHub, потому что они уже есть в проекте.

4. Подключить GitHub-репозиторий:

```powershell
git remote add origin https://github.com/USERNAME/vsau-schedule-site.git
```

Вместо `USERNAME` указать свой логин GitHub.

5. Отправить проект:

```powershell
git push -u origin main
```

Если Git попросит авторизацию, войти через браузер или использовать GitHub Desktop.

Если надо изменить коммит перед отправкой:

```powershell
git add .
git commit -m "Update site"
```

## Вариант 2: через GitHub Desktop

1. Открыть GitHub Desktop.
2. `File` -> `Add local repository`.
3. Выбрать папку:

```text
C:\Users\ioank\OneDrive\Документы\New project\vsau_public_deploy
```

4. Сделать commit.
5. Нажать `Publish repository`.

## Проверка после загрузки

В репозитории должны быть файлы:

```text
README.md
DEPLOY.md
public_server.py
requirements.txt
render.yaml
Dockerfile
vsau_schedule_site/
vsau_teacher_schedule_site/
vsau_room_schedule_site/
```
