const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

const PORT = process.env.PORT || 10000;

const CHANNEL = (process.env.CHANNEL || '@mussliim111')
  .replace(/^@/, '')
  .trim();

const CHANNEL_URL = `https://t.me/s/${CHANNEL}`;

const POSTS_LIMIT = 12;

// Проверка Telegram каждые 15 секунд
const REFRESH_INTERVAL = 15 * 1000;

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


/* =========================================================
   СОСТОЯНИЕ
========================================================= */

let cache = [];

let lastUpdated = null;

let refreshing = false;


/* =========================================================
   ОЧИСТКА ТЕКСТА
========================================================= */

function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}


/* =========================================================
   ПОЛУЧЕНИЕ URL КАРТИНКИ
========================================================= */

function extractBackgroundImage(style = '') {
  const match = style.match(
    /url\(['"]?([^'")]+)['"]?\)/
  );

  return match ? match[1] : '';
}


/* =========================================================
   ПОЛУЧЕНИЕ ПОСТОВ TELEGRAM
========================================================= */

async function fetchPublicTelegramPosts() {

  const response = await fetch(
    CHANNEL_URL,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',

        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

        'Accept-Language':
          'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Telegram HTTP ${response.status}`
    );
  }

  const html = await response.text();

  const $ = cheerio.load(html);

  const posts = [];


  $('.tgme_widget_message').each(
    (_, element) => {

      const node = $(element);


      /* =====================================================
         ID TELEGRAM
      ===================================================== */

      const dataPost =
        node.attr('data-post') || '';

      const id =
        dataPost.split('/').pop();

      if (!id) {
        return;
      }


      /* =====================================================
         ТЕКСТ
      ===================================================== */

      const text = cleanText(
        node
          .find('.tgme_widget_message_text')
          .text()
      );


      /* =====================================================
         ДАТА
      ===================================================== */

      const date =
        node
          .find('time')
          .attr('datetime') || '';


      /* =====================================================
         ССЫЛКА
      ===================================================== */

      const link =
        node
          .find('.tgme_widget_message_date')
          .attr('href') ||
        `https://t.me/${CHANNEL}/${id}`;


      /* =====================================================
         КАРТИНКА
      ===================================================== */

      let image = '';


      // Фото

      const photo =
        node
          .find('.tgme_widget_message_photo_wrap')
          .first();

      if (photo.length) {

        image =
          extractBackgroundImage(
            photo.attr('style') || ''
          );

      }


      // Видео

      if (!image) {

        const video =
          node
            .find('.tgme_widget_message_video_player')
            .first();

        if (video.length) {

          image =
            extractBackgroundImage(
              video.attr('style') || ''
            );

        }

      }


      // Дополнительный поиск media

      if (!image) {

        const media =
          node
            .find('[style*="background-image"]')
            .first();

        if (media.length) {

          image =
            extractBackgroundImage(
              media.attr('style') || ''
            );

        }

      }


      /* =====================================================
         ПРОПУСКАЕМ ПОЛНОСТЬЮ ПУСТЫЕ ПОСТЫ
      ===================================================== */

      if (!text && !image) {
        return;
      }


      /* =====================================================
         СОХРАНЯЕМ
      ===================================================== */

      posts.push({
        id: String(id),

        text:
          text || 'Новое напоминание',

        date,

        image,

        url: link
      });

    }
  );


  /*
   * Сначала старые,
   * поэтому переворачиваем.
   *
   * Получаем:
   *
   * новый
   * ↓
   * старый
   */

  posts.reverse();

  return posts;
}


/* =========================================================
   УДАЛЕНИЕ ДУБЛЕЙ ПО ID
========================================================= */

function uniquePostsById(posts) {

  const seen = new Set();

  return posts.filter(post => {

    if (!post || !post.id) {
      return false;
    }

    const id = String(post.id);

    if (seen.has(id)) {
      return false;
    }

    seen.add(id);

    return true;

  });
}


/* =========================================================
   СИНХРОНИЗАЦИЯ
========================================================= */

async function refreshPosts() {

  if (refreshing) {
    return cache;
  }

  refreshing = true;

  try {

    console.log('');
    console.log('========================================');
    console.log('[Telegram] Начинаем синхронизацию');
    console.log(`Канал: @${CHANNEL}`);
    console.log('========================================');


    /* =====================================================
       ПОЛУЧАЕМ АКТУАЛЬНЫЕ ПОСТЫ
    ===================================================== */

    const telegramPosts =
      await fetchPublicTelegramPosts();


    console.log(
      `[Telegram] Получено постов: ${telegramPosts.length}`
    );


    /* =====================================================
       УНИКАЛЬНЫЕ ПО ID
    ===================================================== */

    const freshPosts =
      uniquePostsById(
        telegramPosts
      );


    /* =====================================================
       ПОСЛЕДНИЕ 12
    ===================================================== */

    const newCache =
      freshPosts.slice(
        0,
        POSTS_LIMIT
      );


    /* =====================================================
       СТАРЫЕ ID
    ===================================================== */

    const oldIds =
      new Set(
        cache.map(
          post => String(post.id)
        )
      );


    /* =====================================================
       НОВЫЕ
    ===================================================== */

    const added =
      newCache.filter(
        post =>
          !oldIds.has(
            String(post.id)
          )
      );


    /* =====================================================
       НОВЫЕ ID
    ===================================================== */

    const newIds =
      new Set(
        newCache.map(
          post => String(post.id)
        )
      );


    /* =====================================================
       УДАЛЁННЫЕ
    ===================================================== */

    const removed =
      cache.filter(
        post =>
          !newIds.has(
            String(post.id)
          )
      );


    /* =====================================================
       ИЗМЕНЁННЫЕ
    ===================================================== */

    const changed = [];

    for (const newPost of newCache) {

      const oldPost =
        cache.find(
          post =>
            String(post.id) ===
            String(newPost.id)
        );

      if (!oldPost) {
        continue;
      }


      const oldText =
        oldPost.text || '';

      const newText =
        newPost.text || '';


      const oldImage =
        oldPost.image || '';

      const newImage =
        newPost.image || '';


      if (
        oldText !== newText ||
        oldImage !== newImage
      ) {

        changed.push(
          newPost
        );

      }

    }


    /* =====================================================
       ЛОГИ
    ===================================================== */

    if (added.length > 0) {

      console.log(
        `[Telegram] + Новых постов: ${added.length}`
      );

      added.forEach(post => {

        console.log(
          `  + ID ${post.id}`
        );

      });

    }


    if (removed.length > 0) {

      console.log(
        `[Telegram] - Удалено постов: ${removed.length}`
      );

      removed.forEach(post => {

        console.log(
          `  - ID ${post.id}`
        );

      });

    }


    if (changed.length > 0) {

      console.log(
        `[Telegram] ✏ Изменено постов: ${changed.length}`
      );

      changed.forEach(post => {

        console.log(
          `  ✏ ID ${post.id}`
        );

      });

    }


    if (
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0
    ) {

      console.log(
        '[Telegram] Изменений нет'
      );

    }


    /* =====================================================
       ГЛАВНОЕ
       
       ЗАМЕНЯЕМ СТАРЫЙ CACHE
       НОВЫМ СОСТОЯНИЕМ TELEGRAM
    ===================================================== */

    cache = newCache;


    lastUpdated =
      new Date().toISOString();


    console.log(
      `[Telegram] На сайте сейчас: ${cache.length}`
    );

    console.log('========================================');


  } catch (error) {

    console.error(
      '[Telegram] Ошибка:',
      error.message
    );

    console.log(
      '[Telegram] Старый cache сохранён'
    );

  } finally {

    refreshing = false;

  }

  return cache;
}


/* =========================================================
   API ПОСТОВ
========================================================= */

app.get(
  '/api/posts',
  async (_req, res) => {

    await refreshPosts();


    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    res.setHeader(
      'Pragma',
      'no-cache'
    );

    res.setHeader(
      'Expires',
      '0'
    );


    res.json({

      channel:
        `@${CHANNEL}`,

      updatedAt:
        lastUpdated,

      posts:
        cache

    });

  }
);


/* =========================================================
   РУЧНОЕ ОБНОВЛЕНИЕ
========================================================= */

app.post(
  '/api/refresh',
  async (_req, res) => {

    const posts =
      await refreshPosts();


    res.json({

      ok: true,

      channel:
        `@${CHANNEL}`,

      updatedAt:
        lastUpdated,

      posts

    });

  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/api/health',
  (_req, res) => {

    res.json({

      ok: true,

      channel:
        `@${CHANNEL}`,

      posts:
        cache.length,

      updatedAt:
        lastUpdated,

      syncing:
        refreshing

    });

  }
);


/* =========================================================
   FRONTEND
========================================================= */

app.use(
  (_req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );

  }
);


/* =========================================================
   ЗАПУСК
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  async () => {

    console.log('');
    console.log('========================================');
    console.log('НАПОМИНАНИЕ v2.1');
    console.log('========================================');

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Telegram: ${CHANNEL_URL}`
    );

    console.log(
      `Limit: ${POSTS_LIMIT}`
    );

    console.log(
      `Sync: ${REFRESH_INTERVAL / 1000} секунд`
    );

    console.log('========================================');


    await refreshPosts();

  }
);


/* =========================================================
   АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ
========================================================= */

setInterval(
  () => {

    refreshPosts();

  },
  REFRESH_INTERVAL
);
