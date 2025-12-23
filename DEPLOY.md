# Деплой на Vercel

## Быстрый старт

### Вариант 1: Через Vercel CLI

1. **Установите Vercel CLI** (если еще не установлен):
```bash
npm i -g vercel
```

2. **Войдите в аккаунт Vercel**:
```bash
vercel login
```

3. **Деплой проекта**:
```bash
cd /Users/landate/Documents/mavel_vibecoder/pre_loader_II
vercel
```

4. **Для продакшн деплоя**:
```bash
vercel --prod
```

### Вариант 2: Через GitHub (рекомендуется)

1. **Создайте репозиторий на GitHub** (если еще нет):
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

2. **Подключите проект в Vercel Dashboard**:
   - Зайдите на [vercel.com](https://vercel.com)
   - Нажмите "Add New Project"
   - Выберите ваш GitHub репозиторий
   - Vercel автоматически определит настройки из `vercel.json`
   - Нажмите "Deploy"

3. **Настройки проекта в Vercel**:
   - **Root Directory**: оставьте пустым (или укажите `.` если нужно)
   - **Build Command**: не требуется (статический сайт)
   - **Output Directory**: `viewer`
   - **Install Command**: не требуется

## Структура проекта для Vercel

Vercel будет деплоить только папку `viewer/` как статический сайт:
- `viewer/index.html` - главная страница
- `viewer/js/main.js` - JavaScript код
- `viewer/default_scenes/` - файлы сцен для загрузки

## Проверка после деплоя

После успешного деплоя проверьте:
1. Главная страница открывается
2. Файлы из `default_scenes/` загружаются (проверьте в Network tab браузера)
3. Drag & Drop работает
4. Все анимации работают

## Проблемы и решения

### Проблема: Файлы из default_scenes не загружаются
**Решение**: Убедитесь, что папка `viewer/default_scenes/` включена в репозиторий и не находится в `.vercelignore`

### Проблема: 404 ошибки для статических файлов
**Решение**: Проверьте, что в `vercel.json` правильно настроен `outputDirectory` и `rewrites`

### Проблема: CORS ошибки
**Решение**: Headers для CORS уже настроены в `vercel.json`, но если проблемы остаются, проверьте настройки в Vercel Dashboard

## Обновление проекта

После каждого изменения в коде:
```bash
git add .
git commit -m "Update viewer"
git push
```

Vercel автоматически задеплоит изменения (если настроен автоматический деплой из GitHub).

Или вручную:
```bash
vercel --prod
```

