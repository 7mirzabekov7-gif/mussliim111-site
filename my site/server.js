const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

const PORT = process.env.PORT || 10000;

const CHANNEL = (process.env.CHANNEL || '@mussliim111')
  .replace(/^@/, '')
  .trim();

const CHANNEL_URL = `https://t.me/s/${CHANNEL}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cache = [];
let lastUpdated = null;
let refreshing = false;


/*
 * Очистка текста
 */
function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}


/*
 * Нормализация текста
 * для удаления одинаковых публикаций
 */
function normalize(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/[«»“”"'.,!?;:—–-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/*
 * Удаление одинаковых публикаций
 */
function uniquePosts(posts) {
  const seen = new Set();

  return posts.filter(post => {
    const key = normalize(post.text);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}


/*
 * Получение АКТУАЛЬНЫХ публикаций
 * из публичной ленты Telegram
 */
async function fetchPublicTelegramPosts() {
  const response = await fetch(CHANNEL_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(
      `Telegram public page HTTP ${response.status}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const posts = [];

  $('.tgme_widget_message').each((_, element) => {
    const node = $(element);

    /*
     * ID сообщения Telegram
     */
    const dataPost = node.attr('data-post') || '';
    const id = dataPost.split('/').pop();

    if (!id) {
      return;
    }

    /*
     * Текст публикации
     */
    const text = cleanText(
      node.find('.tgme_widget_message_text').text()
    );

    /*
     * Дата публикации
     */
    const time =
      node.find('time').attr('datetime') || '';

    /*
     * Ссылка на публикацию
     */
    const link =
      node.find('.tgme_widget_message_date').attr('href') ||
      `https://t.me/${CHANNEL}/${id}`;

    let image = '';

    /*
     * Фото публикации
     */
    const photo = node
      .find('.tgme_widget_message_photo_wrap')
      .first();

    if (photo.length) {
      const style = photo.attr('style') || '';

      const match = style.match(
        /url\(['"]?([^'")]+)['"]?\)/
      );

      if (match) {
        image = match[1];
      }
    }

    /*
     * Видео-превью
     */
    if (!image) {
      const video = node
        .find('.tgme_widget_message_video_player')
        .first();

      const style = video.attr('style') || '';

      const match = style.match(
        /url\(['"]?([^'")]+)['"]?\)/
      );

      if (match) {
        image = match[1];
      }
    }

    /*
     * Если нет ни текста,
     * ни картинки — пропускаем
     */
    if (!text && !image) {
      return;
    }

    posts.push({
      id,
      text: text || 'Новое напоминание',
      date: time,
      image,
      url: link
    });
  });

  /*
   * Самые новые публикации будут первыми
   */
  return posts.reverse();
}


/*
 * Обновление публикаций
 */
async function refreshPosts() {
  if (refreshing) {
    return cache;
  }

  refreshing = true;

  try {
    console.log(
      '[Telegram] Получаем актуальные публикации...'
    );

    /*
     * Получаем текущее состояние канала
     */
    const publicPosts =
      await fetchPublicTelegramPosts();

    console.log(
      `[Telegram] Получено публикаций: ${publicPosts.length}`
    );

    /*
     * Убираем одинаковые публикации
     */
    const unique = uniquePosts(publicPosts);

    /*
     * ВАЖНО:
     *
     * Мы полностью заменяем cache новым списком.
     *
     * Поэтому:
     *
     * новый пост → появляется
     * удалённый пост → исчезает
     * изменённый пост → обновляется
     */
    cache = unique.slice(0, 12);

    /*
     * Обновляем время
     */
    lastUpdated = new Date().toISOString();

    console.log(
      `[Telegram] На сайте сейчас: ${cache.length} публикаций`
    );

  } catch (error) {

    /*
     * Если Telegram временно недоступен,
     * НЕ удаляем уже загруженные публикации.
     *
     * Это важно:
     * временная ошибка Telegram не должна
     * очищать весь сайт.
     */
    console.error(
      '[Telegram] Refresh failed:',
      error.message
    );

  } finally {
    refreshing = false;
  }

  return cache;
}


/*
 * API публикаций
 */
app.get('/api/posts', async (_req, res) => {

  await refreshPosts();

  res.json({
    channel: `@${CHANNEL}`,
    updatedAt: lastUpdated,
    posts: cache
  });
});


/*
 * Проверка сервера
 */
app.get('/api/health', (_req, res) => {

  res.json({
    ok: true,
    channel: `@${CHANNEL}`,
    posts: cache.length,
    updatedAt: lastUpdated
  });

});


/*
 * Все остальные запросы
 * отправляем на index.html
 */
app.use((_req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );

});


/*
 * Запуск сервера
 */
app.listen(
  PORT,
  '0.0.0.0',
  async () => {

    console.log(
      `Напоминание v1.9 started on port ${PORT}`
    );

    console.log(
      `Telegram source: ${CHANNEL_URL}`
    );

    await refreshPosts();

  }
);


/*
 * Автоматическое обновление
 * каждую минуту
 */
setInterval(
  refreshPosts,
  60 * 1000
);
