const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

const PORT = process.env.PORT || 10000;

const CHANNEL = (process.env.CHANNEL || 'mussliim111')
  .replace(/^@/, '')
  .trim();

const CHANNEL_URL = `https://t.me/s/${CHANNEL}`;

const POSTS_LIMIT = 12;

const REFRESH_INTERVAL = 15000;

let cache = [];
let lastUpdated = null;
let refreshing = false;

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


/* =========================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
========================================================= */

function cleanText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


function extractBackgroundImage(style = '') {
  const match = String(style).match(
    /background-image\s*:\s*url\((['"]?)(.*?)\1\)/i
  );

  if (match) {
    return match[2];
  }

  const simple = String(style).match(
    /url\((['"]?)(.*?)\1\)/i
  );

  return simple
    ? simple[2]
    : '';
}


function absoluteUrl(url = '') {
  if (!url) {
    return '';
  }

  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  if (url.startsWith('http://')) {
    return url;
  }

  if (url.startsWith('https://')) {
    return url;
  }

  return 'https://t.me' + url;
}


/* =========================================================
   ПОЛУЧЕНИЕ TELEGRAM
========================================================= */

async function getTelegramHTML() {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      20000
    );

  try {

    console.log(
      `[Telegram] GET ${CHANNEL_URL}`
    );

    const response =
      await fetch(
        CHANNEL_URL,
        {
          method: 'GET',

          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

            'Accept':
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

            'Accept-Language':
              'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',

            'Cache-Control':
              'no-cache',

            'Pragma':
              'no-cache'
          },

          redirect: 'follow',

          signal: controller.signal
        }
      );

    const html =
      await response.text();

    console.log(
      `[Telegram] HTTP: ${response.status}`
    );

    console.log(
      `[Telegram] HTML length: ${html.length}`
    );

    if (!response.ok) {
      throw new Error(
        `Telegram HTTP ${response.status}`
      );
    }

    return {
      html,
      status: response.status,
      finalUrl: response.url
    };

  } finally {

    clearTimeout(timeout);

  }
}


/* =========================================================
   ПАРСИНГ
========================================================= */

function parseTelegramHTML(html) {

  const $ =
    cheerio.load(html);

  const posts = [];

  const nodes =
    $('.tgme_widget_message');

  console.log(
    `[Parser] .tgme_widget_message: ${nodes.length}`
  );


  nodes.each(
    (_, element) => {

      const node =
        $(element);


      /* -----------------------------------------------------
         ID
      ----------------------------------------------------- */

      const dataPost =
        node.attr('data-post') ||
        '';

      let id =
        dataPost
          .split('/')
          .pop();


      /*
       * Запасной способ.
       */

      if (!id) {

        const dateHref =
          node
            .find(
              '.tgme_widget_message_date'
            )
            .attr('href') ||
          '';

        const match =
          dateHref.match(
            /\/(\d+)(?:\?.*)?$/
          );

        if (match) {
          id = match[1];
        }

      }


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
          .attr('datetime') ||
        '';


      /* -----------------------------------------------------
         ССЫЛКА
      ----------------------------------------------------- */

      let url =
        node
          .find(
            '.tgme_widget_message_date'
          )
          .attr('href') ||
        '';


      if (!url) {

        url =
          `https://t.me/${CHANNEL}/${id}`;

      } else {

        url =
          absoluteUrl(url);

      }


      /* -----------------------------------------------------
         КАРТИНКА
      ----------------------------------------------------- */

      let image = '';


      /*
       * Фото Telegram.
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
            photo.attr('style') ||
            ''
          );

      }


      /*
       * Видео.
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
              video.attr('style') ||
              ''
            );

        }

      }


      /*
       * Любой элемент
       * с background-image.
       */

      if (!image) {

        node
          .find('[style]')
          .each(
            (_, el) => {

              if (image) {
                return;
              }

              const style =
                $(el)
                  .attr('style') ||
                '';

              if (
                style.includes(
                  'background-image'
                )
              ) {

                image =
                  extractBackgroundImage(
                    style
                  );

              }

            }
          );

      }


      /*
       * Приводим URL картинки
       * к нормальному виду.
       */

      image =
        absoluteUrl(image);


      /* -----------------------------------------------------
         СОХРАНЯЕМ
      ----------------------------------------------------- */

      posts.push({

        id:
          String(id),

        text:
          text ||
          'Новое напоминание',

        date,

        image,

        url

      });

    }
  );


  /*
   * Telegram:
   * старые -> новые.
   *
   * Нам:
   * новые -> старые.
   */

  posts.reverse();


  /*
   * Удаляем дубли.
   */

  const unique = [];

  const seen =
    new Set();


  for (const post of posts) {

    if (
      seen.has(post.id)
    ) {
      continue;
    }

    seen.add(post.id);

    unique.push(post);

  }


  return unique;
}


/* =========================================================
   ПОЛУЧЕНИЕ ПОСТОВ
========================================================= */

async function fetchTelegramPosts() {

  const result =
    await getTelegramHTML();

  const posts =
    parseTelegramHTML(
      result.html
    );


  console.log(
    `[Telegram] Найдено постов: ${posts.length}`
  );


  return {
    posts,
    htmlLength:
      result.html.length,

    status:
      result.status,

    finalUrl:
      result.finalUrl
  };
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

    console.log(
      '----------------------------------------'
    );

    console.log(
      '[SYNC] Начало синхронизации'
    );


    const result =
      await fetchTelegramPosts();


    const freshPosts =
      result.posts.slice(
        0,
        POSTS_LIMIT
      );


    const oldMap =
      new Map(
        cache.map(
          post => [
            String(post.id),
            post
          ]
        )
      );


    const newMap =
      new Map(
        freshPosts.map(
          post => [
            String(post.id),
            post
          ]
        )
      );


    /* =====================================================
       НОВЫЕ
    ===================================================== */

    for (const post of freshPosts) {

      if (
        !oldMap.has(
          String(post.id)
        )
      ) {

        console.log(
          `[SYNC] + Новый пост: ${post.id}`
        );

      }

    }


    /* =====================================================
       УДАЛЁННЫЕ
    ===================================================== */

    for (const oldPost of cache) {

      if (
        !newMap.has(
          String(oldPost.id)
        )
      ) {

        console.log(
          `[SYNC] - Удалён пост: ${oldPost.id}`
        );

      }

    }


    /* =====================================================
       ИЗМЕНЁННЫЕ
    ===================================================== */

    for (const post of freshPosts) {

      const oldPost =
        oldMap.get(
          String(post.id)
        );


      if (!oldPost) {
        continue;
      }


      const changed =
        oldPost.text !== post.text ||
        oldPost.image !== post.image ||
        oldPost.date !== post.date ||
        oldPost.url !== post.url;


      if (changed) {

        console.log(
          `[SYNC] ✏ Изменён пост: ${post.id}`
        );

      }

    }


    /*
     * ВАЖНО:
     *
     * Не добавляем новые к старым.
     *
     * Полностью заменяем cache.
     *
     * Поэтому удалённые сообщения
     * действительно исчезают.
     */

    cache =
      freshPosts;


    lastUpdated =
      new Date().toISOString();


    console.log(
      `[SYNC] Сейчас на сайте: ${cache.length}`
    );

    console.log(
      '[SYNC] Синхронизация завершена'
    );

    console.log(
      '----------------------------------------'
    );


  } catch (error) {

    console.error(
      '[SYNC] ОШИБКА:',
      error.message
    );

  } finally {

    refreshing =
      false;

  }


  return cache;
}


/* =========================================================
   API POSTS
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
   DEBUG
========================================================= */

app.get(
  '/api/debug',
  async (_req, res) => {

    try {

      const result =
        await fetchTelegramPosts();


      res.json({

        ok:
          true,

        channel:
          `@${CHANNEL}`,

        channelUrl:
          CHANNEL_URL,

        finalUrl:
          result.finalUrl,

        httpStatus:
          result.status,

        htmlLength:
          result.htmlLength,

        telegramPostsFound:
          result.posts.length,

        sitePosts:
          cache.length,

        posts:
          result.posts,

        updatedAt:
          lastUpdated

      });

    } catch (error) {

      res.status(500).json({

        ok:
          false,

        channel:
          `@${CHANNEL}`,

        channelUrl:
          CHANNEL_URL,

        error:
          error.message,

        sitePosts:
          cache.length,

        updatedAt:
          lastUpdated

      });

    }

  }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
  '/api/health',
  (_req, res) => {

    res.json({

      ok:
        true,

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
   РУЧНОЕ ОБНОВЛЕНИЕ
========================================================= */

app.post(
  '/api/refresh',
  async (_req, res) => {

    const posts =
      await refreshPosts();


    res.json({

      ok:
        true,

      count:
        posts.length,

      posts,

      updatedAt:
        lastUpdated

    });

  }
);


/* =========================================================
   FRONTEND
========================================================= */

app.get(
  '/',
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
   FALLBACK
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
      'НАПОМИНАНИЕ — SERVER'
    );

    console.log(
      '========================================'
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `CHANNEL: @${CHANNEL}`
    );

    console.log(
      `URL: ${CHANNEL_URL}`
    );

    console.log(
      `LIMIT: ${POSTS_LIMIT}`
    );

    console.log(
      `SYNC: ${REFRESH_INTERVAL / 1000}s`
    );

    console.log(
      '========================================'
    );


    await refreshPosts();

  }
);


/* =========================================================
   АВТОСИНХРОНИЗАЦИЯ
========================================================= */

setInterval(
  () => {

    refreshPosts()
      .catch(
        error => {
          console.error(
            '[AUTO SYNC]',
            error
          );
        }
      );

  },
  REFRESH_INTERVAL
);
