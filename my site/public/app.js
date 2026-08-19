const postsEl = document.getElementById('posts');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function renderPosts(posts) {
  if (!posts.length) {
    postsEl.innerHTML = '<div class="empty">Пока не удалось загрузить публикации. Попробуйте обновить страницу.</div>';
    return;
  }

  postsEl.innerHTML = posts.map(post => {
    const image = post.image ? `<img class="post-image" src="${escapeHtml(post.image)}" alt="" loading="lazy">` : '';
    const date = formatDate(post.date);
    return `
      <article class="post">
        ${image}
        <div class="post-body">
          <p class="post-text">${escapeHtml(post.text)}</p>
          <div class="post-meta">
            <span>${escapeHtml(date)}</span>
            <a class="post-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener">Открыть →</a>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function loadPosts(showLoading = true) {
  if (showLoading) statusEl.textContent = 'Обновляем публикации…';
  refreshBtn.disabled = true;
  try {
    const response = await fetch('/api/posts?ts=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    renderPosts(data.posts || []);
    const time = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    statusEl.textContent = time ? `@${data.channel.replace(/^@/, '')} · обновлено в ${time}` : `@${data.channel.replace(/^@/, '')}`;
  } catch (error) {
    statusEl.textContent = 'Не удалось обновить ленту. Попробуйте ещё раз.';
    console.error(error);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', () => loadPosts(true));
loadPosts(true);
setInterval(() => loadPosts(false), 60 * 1000);
