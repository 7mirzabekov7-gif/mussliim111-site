const postsEl = document.getElementById('posts');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function renderPosts(posts) {
  if (!Array.isArray(posts) || !posts.length) {
    postsEl.innerHTML = `
      <div class="empty">
        Пока не удалось загрузить публикации.<br>
        Нажмите обновить ещё раз.
      </div>
    `;
    return;
  }

  postsEl.innerHTML = posts.map(post => {
    const image = post.image
      ? `
        <img
          class="post-image"
          src="${escapeHtml(post.image)}"
          alt=""
          loading="lazy"
          onerror="this.style.display='none'"
        >
      `
      : '';

    const date = formatDate(post.date);

    return `
      <article class="post">
        ${image}

        <div class="post-body">
          <p class="post-text">
            ${escapeHtml(post.text || 'Новое напоминание')}
          </p>

          <div class="post-meta">
            <span>${escapeHtml(date)}</span>

            ${
              post.url
                ? `
                  <a
                    class="post-link"
                    href="${escapeHtml(post.url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Открыть →
                  </a>
                `
                : ''
            }
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function loadPosts(showLoading = true) {
  if (showLoading) {
    statusEl.textContent = 'Обновляем публикации…';
  }

  refreshBtn.disabled = true;

  // Чтобы кнопка никогда не зависала навсегда
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(
      '/api/posts?ts=' + Date.now(),
      {
        cache: 'no-store',
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.posts)) {
      throw new Error('Неверный ответ сервера');
    }

    renderPosts(data.posts);

    const channel = data.channel
      ? '@' + String(data.channel).replace(/^@/, '')
      : '@mussliim111';

    const time = data.updatedAt
      ? new Date(data.updatedAt).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '';

    statusEl.textContent = time
      ? `${channel} · обновлено в ${time}`
      : channel;

  } catch (error) {

    console.error('Ошибка загрузки публикаций:', error);

    if (error.name === 'AbortError') {
      statusEl.textContent =
        'Telegram отвечает слишком долго. Нажмите обновить ещё раз.';
    } else {
      statusEl.textContent =
        'Не удалось загрузить публикации. Нажмите обновить ещё раз.';
    }

  } finally {
    clearTimeout(timeout);
    refreshBtn.disabled = false;
  }
}

// Кнопка обновления
refreshBtn.addEventListener('click', async () => {
  await loadPosts(true);
});

// Первая загрузка
loadPosts(true);

// Автоматическое обновление раз в минуту
setInterval(() => {
  loadPosts(false);
}, 15 * 1000);
