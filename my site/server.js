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

// Проверяем Telegram каждые 15 секунд
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
   ПОЛУЧЕНИЕ КАРТИНКИ
========================================================= */

function extractBackgroundImage(style = '') {

  const match = style.match(
    /url\(['"]?([^'")]+)['"]?\)/
  );

  return match
    ? match[1]
    : '';
}


/* =========================================================
   ПОЛУЧЕНИЕ ПУБЛИКАЦИЙ TELEGRAM
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


  const html =
    await response.text();


  const $ =
    cheerio.load(html);


  const posts = [];


  $('.tgme_widget_message').each(
    (_, element) => {

      const node =
        $(element);


      /* -----------------------------------------------------
         ID сообщения Telegram
      ----------------------------------------------------- */

      const dataPost =
        node.attr('data-post') || '';


      const id =
        dataPost.split('/').pop();


      if (!id) {
        return;
      }


      /* -----------------------------------------------------
         ТЕКСТ
      ----------------------------------------------------- */

      const text =
        cleanText(
          node
            .find(
              '.tgme_widget_message_text'
            )
            .text()
        );


      /* -----------------------------------------------------
         ДАТА
      ----------------------------------------------------- */

      const date =
        node
          .find('time')
          .attr('datetime') || '';


      /* -----------------------------------------------------
         ССЫЛКА
      ----------------------------------------------------- */

      const link =
        node
          .find(
            '.tgme_widget_message_date'
          )
          .attr('href') ||

        `https://t.me/${CHANNEL}/${id}`;


      /* -----------------------------------------------------
         ИЗОБРАЖЕНИЕ
      ----------------------------------------------------- */

      let image = '';


      /*
       * Фото
       */

      const photo =
        node
          .find(
            '.tgme_widget_message_photo_wrap'
          )
          .first();


      if (photo.length) {

        image =
          extractBackgroundImage(
            photo.attr('style') || ''
          );

      }


      /*
       * Если фото нет —
       * пробуем видео-превью
       */

      if (!image) {

        const video =
          node
            .find(
              '.tgme_widget_message_video_player'
            )
            .first();


        if (video.length) {

          image =
            extractBackgroundImage(
              video.attr('style') || ''
            );

        }

      }


      /*
       * Иногда Telegram использует
       * background-image непосредственно
       * на media wrapper.
       */

      if (!image) {

        const media =
          node
            .find(
              '[style*="background-image"]'
            )
            .first();


        if (media.length) {

          image =
            extractBackgroundImage(
              media.attr('style') || ''
            );

        }

      }


      /* -----------------------------------------------------
         НЕ ПУСТОЙ ПОСТ
      ----------------------------------------------------- */

      if (!text && !image) {
        return;
      }


      /* -----------------------------------------------------
         ДОБАВЛЯЕМ
      ----------------------------------------------------- */

      posts.push({

        /*
         * Очень важно:
         * ID Telegram используется как
         * уникальный идентификатор.
         */

        id: String(id),

        text:
          text ||
          'Новое напоминание',

        date,

        image,

        url: link

      });

    }
  );


  /*
   * Telegram отдаёт публикации
   * от старых к новым.
   *
   * Разворачиваем:
   * новые -> старые
   */

  posts.reverse();


  return posts;
}


/* =========================================================
   УДАЛЕНИЕ ДУБЛЕЙ ПО ID
========================================================= */

function uniquePostsById(posts) {

  const seen =
    new Set();


  return posts.filter(
    post => {

      if (!post || !post.id) {
        return false;
      }


      const id =
        String(post.id);


      if (seen.has(id)) {
        return false;
      }


      seen.add(id);


      return true;

    }
  );
}


/* =========================================================
   СИНХРОНИЗАЦИЯ
========================================================= */

async function refreshPosts() {

  /*
   * Если предыдущая проверка ещё идёт,
   * новую не запускаем.
   */

  if (refreshing) {

    return cache;

  }


  refreshing = true;


  try {

    console.log(
      '[Telegram] Проверяем канал...'
    );


    /*
     * Получаем АКТУАЛЬНОЕ состояние
     * публичной ленты Telegram.
     */

    const telegramPosts =
      await fetchPublicTelegramPosts();


    console.log(
      `[Telegram] Получено: ${telegramPosts.length}`
    );


    /*
     * Убираем дубли только по ID.
     *
     * НЕ по тексту.
     *
     * Поэтому два одинаковых текста
     * в разных Telegram-сообщениях
     * будут отображаться оба.
     */

    const freshPosts =
      uniquePostsById(
        telegramPosts
      );


    /*
     * Берём только последние N.
     */

    const newCache =
      freshPosts.slice(
        0,
        POSTS_LIMIT
      );


    /* -----------------------------------------------------
       АНАЛИЗ ИЗМЕНЕНИЙ
    ----------------------------------------------------- */

    const oldIds =
      new Set(
        cache.map(
          post =>
            String(post.id)
        )
      );


    const newIds =
      new Set(
        newCache.map(
          post =>
            String(post.id)
        )
      );


    /*
     * Новые посты
     */

    const added =
      newCache.filter(
        post =>
          !oldIds.has(
            String(post.id)
          )
      );


    /*
     * Удалённые посты
     *
     * Если ID был на сайте,
     * но Telegram больше его не отдаёт,
     * значит пост исчез.
     */

    const removed =
      cache.filter(
        post =>
          !newIds.has(
            String(post.id)
          )
      );


    /*
     * Изменённые посты
     */

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


    /* -----------------------------------------------------
       ЛОГ
    ----------------------------------------------------- */

    if (added.length) {

      console.log(
        `[Telegram] + Новых: ${added.length}`
      );

    }


    if (removed.length) {

      console.log(
        `[Telegram] - Удалено: ${removed.length}`
      );


      removed.forEach(
        post => {

          console.log(
            `[Telegram] Удалён пост ID: ${post.id}`
          );

        }
      );

    }


    if (changed.length) {

      console.log(
        `[Telegram] ✏ Изменено: ${changed.length}`
      );

    }


    /* -----------------------------------------------------
       ГЛАВНОЕ
       ПОЛНОСТЬЮ ЗАМЕНЯЕМ CACHE
    ----------------------------------------------------- */

    cache =
      newCache;


    lastUpdated =
      new Date().toISOString();


    console.log(
      `[Telegram] Сейчас на сайте: ${cache.length}`
    );


  } catch (error) {

    /*
     * При ошибке Telegram
     * НЕ трогаем cache.
     *
     * Например:
     *
     * Telegram временно недоступен
     *
     * -> старые посты остаются.
     */

    console.error(
      '[Telegram] Ошибка синхронизации:',
      error.message
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
   РУЧНАЯ СИНХРОНИЗАЦИЯ
========================================================= */

app.post(
  '/api/refresh',
  async (_req, res) => {

    const posts =
      await refreshPosts();


    res.json({

      ok: true,

      posts

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

    console.log(
      '========================================'
    );

    console.log(
      'Напоминание v2.0'
    );

    console.log(
      '========================================'
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Telegram: ${CHANNEL_URL}`
    );

    console.log(
      `Posts limit: ${POSTS_LIMIT}`
    );

    console.log(
      `Sync interval: ${REFRESH_INTERVAL / 1000}s`
    );

    console.log(
      '========================================'
    );


    /*
     * Первая синхронизация
     */

    await refreshPosts();

  }
);


/* =========================================================
   АВТОСИНХРОНИЗАЦИЯ
========================================================= */

setInterval(
  async () => {

    await refreshPosts();

  },
  REFRESH_INTERVAL
);
