const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

const PORT = process.env.PORT || 10000;

const CHANNEL = (process.env.CHANNEL || '@mussliim111')
  .replace(/^@/, '')
  .trim();

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();

const CHANNEL_URL = `https://t.me/s/${CHANNEL}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cache = [];
let lastUpdated = null;
let refreshing = false;


/* =========================
   ТЕКСТ
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
   ПУБЛИЧНЫЙ TELEGRAM
========================= */

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


    /* Ссылка */

    const url =
      node
        .find('.tgme_widget_message_date')
        .attr('href') ||
      `https://t.me/${CHANNEL}/${id}`;


    /* Картинка */

    let image = '';


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


    /* Видео */

    if (!image) {

      const video =
        node
          .find('.tgme_widget_message_video_player')
          .first();

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


    if (!text && !image) {
      return;
    }


    posts.push({
      id,
      text: text || 'Новое напоминание',
      date,
      image,
      url
    });

  });


  /*
   * Новые сначала
   */

  return posts.reverse();
}


/* =========================
   BOT API
========================= */

async function fetchBotUpdates() {

  if (!BOT_TOKEN) {
    return [];
  }


  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates` +
    `?timeout=1&allowed_updates=%5B%22channel_post%22%5D`;


  const response =
    await fetch(url);


  if (!response.ok) {
    throw new Error(
      `Telegram Bot API HTTP ${response.status}`
    );
  }


  const data =
    await response.json();


  if (!data.ok) {

    throw new Error(
      `Telegram Bot API: ${
        data.description || 'Unknown error'
      }`
    );

  }


  const posts = [];


  for (const update of data.result || []) {

    const message =
      update.channel_post;


    if (!message) {
      continue;
    }


    const username =
      message.chat?.username || '';


    if (
      username &&
      username.toLowerCase() !==
      CHANNEL.toLowerCase()
    ) {
      continue;
    }


    const id =
      String(message.message_id);


    const text =
      cleanText(
        message.text ||
        message.caption ||
        ''
      );


    if (!text) {
      continue;
    }


    posts.push({

      id: `bot-${id}`,

      text,

      date: message.date
        ? new Date(
            message.date * 1000
          ).toISOString()
        : '',

      image: '',

      url:
        `https://t.me/${CHANNEL}/${id}`

    });

  }


  return posts;
}


/* =========================
   ОБНОВЛЕНИЕ
========================= */

async function refreshPosts() {

  if (refreshing) {
    return cache;
  }


  refreshing = true;


  try {

    let publicPosts = [];

    let botPosts = [];


    /*
     * Сначала публичная лента
     */

    try {

      publicPosts =
        await fetchPublicTelegramPosts();


      console.log(
        `[Telegram] Public posts: ${publicPosts.length}`
      );

    } catch (error) {

      console.error(
        '[Telegram] Public feed failed:',
        error.message
      );

    }


    /*
     * Затем Bot API
     */

    try {

      botPosts =
        await fetchBotUpdates();


      console.log(
        `[Telegram] Bot posts: ${botPosts.length}`
      );

    } catch (error) {

      console.error(
        '[Telegram] Bot API failed:',
        error.message
      );

    }


    /*
     * Объединяем.
     *
     * Публичные посты идут первыми,
     * поэтому актуальная версия поста
     * имеет приоритет.
     */

    const combined =
      uniquePosts([
        ...publicPosts,
        ...botPosts
      ]);


    /*
     * Если получили данные —
     * полностью обновляем список.
     */

    if (combined.length > 0) {

      cache =
        combined.slice(0, 12);

      lastUpdated =
        new Date().toISOString();


      console.log(
        `[Telegram] Website posts: ${cache.length}`
      );

    } else {

      console.log(
        `[Telegram] No posts received. Cache kept: ${cache.length}`
      );

    }

  } catch (error) {

    console.error(
      '[Telegram] Refresh failed:',
      error.message
    );

  } finally {

    refreshing = false;

  }


  return cache;
}


/* =========================
   API
========================= */

app.get(
  '/api/posts',
  async (_req, res) => {

    await refreshPosts();


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


/* =========================
   HEALTH
========================= */

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
        lastUpdated

    });

  }
);


/* =========================
   SITE
========================= */

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


/* =========================
   START
========================= */

app.listen(
  PORT,
  '0.0.0.0',
  async () => {

    console.log(
      `Напоминание v1.9.1 started on port ${PORT}`
    );

    console.log(
      `Telegram source: ${CHANNEL_URL}`
    );

    console.log(
      `Bot API: ${
        BOT_TOKEN
          ? 'configured'
          : 'NOT configured'
      }`
    );


    await refreshPosts();

  }
);


/* =========================
   AUTO REFRESH
========================= */

setInterval(
  refreshPosts,
  60 * 1000
);
