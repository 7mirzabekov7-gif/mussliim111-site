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

const fallbackPosts = [
  {
    id: 'fallback-1',
    text: 'И напоминай, ибо напоминание приносит пользу верующим.',
    date: '',
    image: '/avatar.jpg',
    url: `https://t.me/${CHANNEL}`
  }
];


/* =========================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
========================= */

function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}


function normalize(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/[«»“”"'.,!?;:—–-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


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


/* =========================
   ПОЛУЧЕНИЕ ПОСТОВ TELEGRAM
========================= */

async function fetchTelegramPosts() {
  console.log(`[Telegram] Loading: ${CHANNEL_URL}`);

  const response = await fetch(CHANNEL_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',

      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

      'Accept-Language':
        'ru-RU,ru;q=0.9,en;q=0.8'
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

    /* ID сообщения */

    const dataPost =
      node.attr('data-post') || '';

    const id =
      dataPost.split('/').pop();

    if (!id) {
      return;
    }


    /* Текст */

    const text = cleanText(
      node
        .find('.tgme_widget_message_text')
        .text()
    );


    /* Дата */

    const date =
      node
        .find('time')
        .attr('datetime') || '';


    /* Ссылка на сообщение */

    let url =
      node
        .find('.tgme_widget_message_date')
        .attr('href');

    if (!url) {
      url = `https://t.me/${CHANNEL}/${id}`;
    }


    /* =========================
       ИЗОБРАЖЕНИЕ
    ========================= */

    let image = '';


    /* Фото */

    const photo =
      node
        .find('.tgme_widget_message_photo_wrap')
        .first();

    if (photo.length) {
      const style =
        photo.attr('style') || '';

      const match =
        style.match(
          /url\(['"]?([^'")]+)['"]?\)/
        );

      if (match) {
        image = match[1];
      }
    }


    /* Видео-превью */

    if (!image) {
      const video =
        node
          .find('.tgme_widget_message_video_player')
          .first();

      if (video.length) {
        const style =
          video.attr('style') || '';

        const match =
          style.match(
            /url\(['"]?([^'")]+)['"]?\)/
          );

        if (match) {
          image = match[1];
        }
      }
    }


    /*
     * Если пост вообще пустой,
     * пропускаем его.
     */

    if (!text && !image) {
      return;
    }


    posts.push({
      id,

      text:
        text || 'Новое напоминание',

      date,

      image,

      url
    });
  });


  /*
   * Telegram обычно отдаёт сообщения
   * от старых к новым.
   *
   * Разворачиваем, чтобы новые были первыми.
   */

  posts.reverse();


  /*
   * Убираем одинаковые публикации.
   */

  const unique =
    uniquePosts(posts);


  /*
   * Оставляем максимум 12 последних.
   */

  return unique.slice(0, 12);
}


/* =========================
   ОБНОВЛЕНИЕ КЭША
========================= */

async function refreshPosts() {

  if (refreshing) {
    return cache;
  }

  refreshing = true;

  try {

    const posts =
      await fetchTelegramPosts();


    console.log(
      `[Telegram] Public posts: ${posts.length}`
    );


    if (posts.length > 0) {

      cache = posts;

      console.log(
        `[Telegram] Cache updated: ${cache.length}`
      );

    } else {

      console.log(
        '[Telegram] No posts found'
      );

    }


    /*
     * Если Telegram временно ничего
     * не отдал и кэш пустой,
     * показываем запасной пост.
     */

    if (!cache.length) {
      cache = fallbackPosts;
    }


    lastUpdated =
      new Date().toISOString();


    console.log(
      `[Telegram] Total posts: ${cache.length}`
    );

  } catch (error) {

    console.error(
      '[Telegram] Refresh failed:',
      error.message
    );


    /*
     * Важно:
     * если старые посты уже есть,
     * НЕ удаляем их при ошибке.
     */

    if (!cache.length) {
      cache = fallbackPosts;
    }

  } finally {

    refreshing = false;

  }

  return cache;
}


/* =========================
   API ПОСТОВ
========================= */

app.get('/api/posts', async (_req, res) => {

  await refreshPosts();

  res.json({

    channel:
      `@${CHANNEL}`,

    updatedAt:
      lastUpdated,

    posts:
      cache

  });

});


/* =========================
   ПРОВЕРКА СЕРВЕРА
========================= */

app.get('/api/health', (_req, res) => {

  res.json({

    ok: true,

    channel:
      `@${CHANNEL}`,

    posts:
      cache.length,

    updatedAt:
      lastUpdated

  });

});


/* =========================
   СТРАНИЦА САЙТА
========================= */

app.use((_req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );

});


/* =========================
   ЗАПУСК
========================= */

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

    /*
     * Первая загрузка сразу
     */

    await refreshPosts();

  }
);


/* =========================
   АВТООБНОВЛЕНИЕ
========================= */

setInterval(
  refreshPosts,
  60 * 1000
);
