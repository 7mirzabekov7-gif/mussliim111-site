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

const fallbackPosts = [
  {
    id: 'fallback-1',
    text: 'И напоминай, ибо напоминание приносит пользу верующим.',
    date: '',
    image: '/avatar.jpg',
    url: `https://t.me/${CHANNEL}`
  }
];

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

/*
 * Получение публикаций из публичной ленты Telegram.
 * Это позволяет получить уже существующие посты канала.
 */
async function fetchPublicTelegramPosts() {
  const response = await fetch(CHANNEL_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Telegram public page HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const posts = [];

  $('.tgme_widget_message').each((_, element) => {
    const node = $(element);

    const dataPost = node.attr('data-post') || '';
    const id = dataPost.split('/').pop();

    if (!id) return;

    const text = cleanText(
      node.find('.tgme_widget_message_text').text()
    );

    const time =
      node.find('time').attr('datetime') || '';

    const link =
      node.find('.tgme_widget_message_date').attr('href') ||
      `https://t.me/${CHANNEL}/${id}`;

    let image = '';

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

    if (!text && !image) return;

    posts.push({
      id,
      text: text || 'Новое напоминание',
      date: time,
      image,
      url: link
    });
  });

  return posts;
}

/*
 * Получение новых публикаций через Bot API.
 *
 * Важно:
 * Bot API используется здесь для получения новых сообщений.
 * Старые сообщения берём из публичной ленты выше.
 */
async function fetchBotUpdates() {
  if (!BOT_TOKEN) {
    return [];
  }

  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates` +
    `?timeout=1&allowed_updates=%5B%22channel_post%22%5D`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Telegram Bot API HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram Bot API: ${data.description || 'Unknown error'}`
    );
  }

  const posts = [];

  for (const update of data.result || []) {
    const message = update.channel_post;

    if (!message) continue;

    const chatUsername =
      message.chat?.username || '';

    if (
      chatUsername &&
      chatUsername.toLowerCase() !== CHANNEL.toLowerCase()
    ) {
      continue;
    }

    const id = String(message.message_id);

    const text = cleanText(
      message.text ||
      message.caption ||
      ''
    );

    if (!text) continue;

    posts.push({
      id: `bot-${id}`,
      text,
      date: message.date
        ? new Date(message.date * 1000).toISOString()
        : '',
      image: '/avatar.jpg',
      url: `https://t.me/${CHANNEL}/${id}`
    });
  }

  return posts;
}

async function refreshPosts() {
  if (refreshing) {
    return cache;
  }

  refreshing = true;

  try {
    let publicPosts = [];
    let botPosts = [];

    /*
     * Получаем старые/существующие посты
     */
    try {
      publicPosts = await fetchPublicTelegramPosts();

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
     * Получаем новые посты через бота
     */
    try {
      botPosts = await fetchBotUpdates();

      if (BOT_TOKEN) {
        console.log(
          `[Telegram] Bot posts: ${botPosts.length}`
        );
      }
    } catch (error) {
      console.error(
        '[Telegram] Bot API failed:',
        error.message
      );
    }

    /*
     * Объединяем оба источника.
     * Одинаковые сообщения убираем.
     */
    const combined = uniquePosts([
      ...botPosts,
      ...publicPosts
    ]);

    if (combined.length) {
      cache = combined
        .slice(0, 12);
    }

    if (!cache.length) {
      cache = fallbackPosts;
    }

    lastUpdated = new Date().toISOString();

    console.log(
      `[Telegram] Total unique posts: ${cache.length}`
    );

  } catch (error) {
    console.error(
      '[Telegram] Refresh failed:',
      error.message
    );

    if (!cache.length) {
      cache = fallbackPosts;
    }

  } finally {
    refreshing = false;
  }

  return cache;
}

/*
 * API для сайта
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
 * Все остальные запросы отправляем на сайт
 */
app.use((_req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(
    `Напоминание v1.8.1 started on port ${PORT}`
  );

  console.log(
    `Telegram source: ${CHANNEL_URL}`
  );

  console.log(
    `Bot API: ${BOT_TOKEN ? 'configured' : 'not configured'}`
  );

  await refreshPosts();
});

/*
 * Автоматическое обновление раз в минуту
 */
setInterval(
  refreshPosts,
  60 * 1000
);
