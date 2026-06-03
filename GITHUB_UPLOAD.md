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

3. Один раз настроить имя и email для Git:

```powershell
git config --global user.name "Ваше имя"
git config --global user.email "ваш-email@example.com"
```

Лучше использовать email от аккаунта GitHub.

4. Сделать коммит:

```powershell
git add .
git commit -m "Initial VSAU schedule site"
```

5. Создать пустой репозиторий на GitHub.

Например с названием:

```text
vsau-schedule-site
```

Не добавлять README, `.gitignore` и License на сайте GitHub, потому что они уже есть в проекте.

6. Подключить GitHub-репозиторий:

```powershell
git branch -M main
git remote add origin https://github.com/USERNAME/vsau-schedule-site.git
```

Вместо `USERNAME` указать свой логин GitHub.

7. Отправить проект:

```powershell
git push -u origin main
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
