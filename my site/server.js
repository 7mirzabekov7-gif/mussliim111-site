const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 10000;
const CHANNEL = (process.env.CHANNEL || '@mussliim111').replace(/^@/, '').trim();
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
    date: '— Сура «Аз-Зарият», 51:55',
    image: '/avatar.jpg',
    url: `https://t.me/${CHANNEL}`
  }
];

function cleanText(value = '') {
  return value
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

async function fetchTelegramPosts() {
  const response = await fetch(CHANNEL_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Telegram returned HTTP ${response.status}`);
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

    const time = node.find('time').attr('datetime') || '';

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
        /url\(['"]?([^'"\)]+)['"]?\)/
      );

      if (match) {
        image = match[1];
      }
    }

    // Если у публикации видео-превью
    if (!image) {
      const video = node
        .find('.tgme_widget_message_video_player')
        .first();

      const style = video.attr('style') || '';

      const match = style.match(
        /url\(['"]?([^'"\)]+)['"]?\)/
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

  return uniquePosts(posts.reverse()).slice(0, 12);
}

async function refreshPosts() {
  if (refreshing) {
    return cache;
  }

  refreshing = true;

  try {
    const posts = await fetchTelegramPosts();

    if (posts.length) {
      cache = posts;
    }

    lastUpdated = new Date().toISOString();

    console.log(
      `[Telegram] Loaded ${posts.length} unique posts`
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

// API: публикации Telegram
app.get('/api/posts', async (_req, res) => {
  await refreshPosts();

  res.json({
    channel: `@${CHANNEL}`,
    updatedAt: lastUpdated,
    posts: cache
  });
});

// API: проверка работы сервера
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    channel: `@${CHANNEL}`,
    updatedAt: lastUpdated
  });
});

// Все остальные страницы отправляем на index.html.
// ВАЖНО: здесь больше нет app.get('*')
app.use((_req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', async () => {
  console.log(
    `Напоминание v1.8 started on port ${PORT}`
  );

  console.log(
    `Telegram source: ${CHANNEL_URL}`
  );

  await refreshPosts();
});

// Обновление Telegram каждые 60 секунд
setInterval(
  refreshPosts,
  60 * 1000
);
