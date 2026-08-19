const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

const PORT = process.env.PORT || 10000;

const CHANNEL = (process.env.CHANNEL || '@mussliim111')
  .replace(/^@/, '')
  .trim();

const CHANNEL_URL = `https://t.me/s/${CHANNEL}`;

const MAX_POSTS = 12;
const REFRESH_INTERVAL = 60 * 1000;


/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


/* =========================================================
   КЭШ
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
   ПОЛУЧЕНИЕ ID TELEGRAM-ПОСТА
========================================================= */

function getTelegramPostId(node) {
  const dataPost =
    node.attr('data-post') || '';

  if (!dataPost) {
    return '';
  }

  const parts =
    dataPost.split('/');

  return parts[parts.length - 1] || '';
}


/* =========================================================
   ПОЛУЧЕНИЕ ИЗОБРАЖЕНИЯ
========================================================= */

function getBackgroundImage(node, selector) {
  const element = node
    .find(selector)
    .first();

  if (!element.length) {
    return '';
  }

  const style =
    element.attr('style') || '';

  const match = style.match(
    /url\(['"]?([^'")]+)['"]?\)/
  );

  return match
    ? match[1]
    : '';
}


/* =========================================================
   ПОЛУЧЕНИЕ АКТУАЛЬНЫХ ПОСТОВ TELEGRAM
========================================================= */

async function fetchPublicTelegramPosts() {

  /*
   * Добавляем уникальный параметр к URL,
   * чтобы не получать старую закэшированную
   * версию публичной страницы Telegram.
   */
  const cacheBuster =
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

  const url =
    `${CHANNEL_URL}?_=${cacheBuster}`;


  console.log(
    `[Telegram] Запрос: ${url}`
  );


  const response = await fetch(
    url,
    {
      method: 'GET',

      cache: 'no-store',

      headers: {
        'Cache-Control':
          'no-cache, no-store, max-age=0',

        'Pragma':
          'no-cache',

        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',

        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }
  );


  if (!response.ok) {
    throw new Error(
      `Telegram public page HTTP ${response.status}`
    );
  }


  const html =
    await response.text();


  if (!html || html.length < 1000) {
    throw new Error(
      'Telegram вернул пустую или неполную страницу'
    );
  }


  const $ =
    cheerio.load(html);


  const posts = [];


  /*
   * Telegram размещает сообщения
   * внутри .tgme_widget_message
   */
  $('.tgme_widget_message').each(
    (_, element) => {

      const node =
        $(element);


      /*
       * =================================================
       * ID ПОСТА
       * =================================================
       */

      const id =
        getTelegramPostId(node);


      if (!id) {
        return;
      }


      /*
       * =================================================
       * ТЕКСТ
       * =================================================
       */

      const text =
        cleanText(
          node
            .find(
              '.tgme_widget_message_text'
            )
            .text()
        );


      /*
       * =================================================
       * ДАТА
       * =================================================
       */

      const date =
        node
          .find('time')
          .attr('datetime') || '';


      /*
       * =================================================
       * ССЫЛКА
       * =================================================
       */

      const telegramLink =
        node
          .find(
            '.tgme_widget_message_date'
          )
          .attr('href');


      const link =
        telegramLink ||
        `https://t.me/${CHANNEL}/${id}`;


      /*
       * =================================================
       * ФОТО
       * =================================================
       */

      let image =
        getBackgroundImage(
          node,
          '.tgme_widget_message_photo_wrap'
        );


      /*
       * =================================================
       * ВИДЕО-ПРЕВЬЮ
       * =================================================
       */

      if (!image) {

        image =
          getBackgroundImage(
            node,
            '.tgme_widget_message_video_player'
          );

      }


      /*
       * =================================================
       * АЛЬБОМ / MEDIA PREVIEW
       * =================================================
       */

      if (!image) {

        image =
          getBackgroundImage(
            node,
            '.tgme_widget_message_roundvideo'
          );

      }


      /*
       * =================================================
       * ПУБЛИКАЦИЯ
       *
       * Должен быть текст или изображение.
       * =================================================
       */

      if (!text && !image) {
        return;
      }


      /*
       * =================================================
       * СОХРАНЯЕМ ПОСТ
       * =================================================
       */

      posts.push({

        /*
         * ВАЖНО:
         * используем настоящий ID Telegram.
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
   * Telegram отдаёт посты
   * от старых к новым.
   *
   * Разворачиваем:
   * новый → старый.
   */
  posts.reverse();


  /*
   * =================================================
   * УБИРАЕМ ДУБЛИ ПО ID
   *
   * НЕ ПО ТЕКСТУ!
   *
   * Это важно, потому что два разных
   * Telegram-поста могут иметь одинаковый текст.
   * =================================================
   */

  const seen =
    new Set();

  const uniquePosts =
    posts.filter(post => {

      if (
        seen.has(post.id)
      ) {
        return false;
      }

      seen.add(post.id);

      return true;

    });


  /*
   * Берём только последние MAX_POSTS.
   */

  return uniquePosts.slice(
    0,
    MAX_POSTS
  );
}


/* =========================================================
   ПОЛНАЯ СИНХРОНИЗАЦИЯ
========================================================= */

async function refreshPosts() {

  /*
   * Если обновление уже идёт,
   * второй запрос не запускаем.
   */
  if (refreshing) {

    console.log(
      '[Telegram] Обновление уже выполняется'
    );

    return cache;

  }


  refreshing = true;


  try {

    console.log(
      '[Telegram] Проверяем актуальные публикации...'
    );


    /*
     * Получаем ТЕКУЩЕЕ состояние Telegram.
     */
    const telegramPosts =
      await fetchPublicTelegramPosts();


    console.log(
      `[Telegram] Сейчас найдено: ${telegramPosts.length}`
    );


    /*
     * =================================================
     * ПОЛНАЯ ЗАМЕНА CACHE
     * =================================================
     *
     * Именно это обеспечивает удаление:
     *
     * Telegram:
     *
     * 100
     * 101
     * 102
     *
     * удалили 101:
     *
     * 100
     * 102
     *
     * cache тоже становится:
     *
     * 100
     * 102
     *
     * Старого 101 больше нет.
     */

    cache =
      telegramPosts;


    /*
     * Время успешной синхронизации.
     */

    lastUpdated =
      new Date().toISOString();


    console.log(
      `[Telegram] Синхронизация завершена. На сайте: ${cache.length}`
    );


    /*
     * Показываем ID для удобной диагностики.
     */

    console.log(
      '[Telegram] ID:',
      cache.map(post => post.id).join(', ')
    );


  } catch (error) {

    /*
     * ВАЖНО:
     *
     * Если Telegram временно недоступен,
     * НЕ очищаем cache.
     *
     * Иначе кратковременный сбой Telegram
     * мог бы удалить все публикации с сайта.
     */

    console.error(
      '[Telegram] Ошибка синхронизации:',
      error.message
    );


    console.log(
      `[Telegram] Сохраняем текущие ${cache.length} публикаций`
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


    res.setHeader(
      'Cache-Control',
      'no-store'
    );


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
   ВСЕ ОСТАЛЬНЫЕ ЗАПРОСЫ
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
    console.log(
      '=========================================='
    );

    console.log(
      'Напоминание v2.0'
    );

    console.log(
      '=========================================='
    );

    console.log(
      `Порт: ${PORT}`
    );

    console.log(
      `Telegram: ${CHANNEL_URL}`
    );

    console.log(
      `Максимум постов: ${MAX_POSTS}`
    );

    console.log(
      'Синхронизация: каждые 60 секунд'
    );

    console.log(
      'Удаление: включено'
    );

    console.log(
      'Изменение постов: включено'
    );

    console.log(
      'Новые посты: включено'
    );

    console.log(
      '=========================================='
    );

    console.log('');


    /*
     * Первая синхронизация
     * сразу после запуска.
     */

    await refreshPosts();

  }
);


/* =========================================================
   АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ
========================================================= */

setInterval(
  async () => {

    console.log('');
    console.log(
      '[Telegram] Автоматическая проверка...'
    );

    await refreshPosts();

  },
  REFRESH_INTERVAL
);
