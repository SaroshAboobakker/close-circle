const MEMBERS = [
  { name: 'Sarosh', color: 's' },
  { name: 'Hassan', color: 'h' },
  { name: 'Anthony', color: 'a' },
  { name: 'Jamser', color: 'j' },
  { name: 'Aris', color: 'r' },
];
const MEMBER_COLOR = Object.fromEntries(MEMBERS.map(member => [member.name, member.color]));
const EMPTY_STATE = { posts: [], events: [], ideas: [] };
const LEGACY_POST_IDS = new Set([1, 2, 3]);
const LEGACY_EVENT_IDS = new Set([11, 12]);
const LEGACY_IDEAS = new Set(['Cabin weekend', 'Try that ramen place', 'Beach day before it gets cold']);

// Repository pattern keeps browser persistence separate from views and UI actions.
const stateRepository = {
  key: 'closeCircleState',
  read() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.key));
      if (!stored || typeof stored !== 'object') return structuredClone(EMPTY_STATE);
      const cleaned = {
        posts: Array.isArray(stored.posts) ? stored.posts.filter(post =>
          !LEGACY_POST_IDS.has(Number(post.id)) &&
          !(post.kind === 'event' && LEGACY_EVENT_IDS.has(Number(post.event?.id)))
        ) : [],
        events: Array.isArray(stored.events) ? stored.events.filter(event => !LEGACY_EVENT_IDS.has(Number(event.id))) : [],
        ideas: Array.isArray(stored.ideas) ? stored.ideas.filter(idea => !LEGACY_IDEAS.has(idea.title)) : [],
      };
      if (JSON.stringify(stored) !== JSON.stringify(cleaned)) this.write(cleaned);
      return cleaned;
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  },
  write(value) {
    localStorage.setItem(this.key, JSON.stringify(value));
  },
  async load() {
    const local = this.read();
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Shared server returned ${response.status}`);
      const remote = await response.json();
      setSyncStatus(true);
      const shared = remote.state || EMPTY_STATE;
      const combined = combineStates(shared, local);
      if (hasContent(local)) {
        const imported = await this.push(combined);
        this.write(imported);
        return imported;
      }
      this.write(shared);
      return shared;
    } catch {
      setSyncStatus(false);
      return local;
    }
  },
  async push(value) {
    const response = await fetch('/api/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    if (!response.ok) throw new Error(`Shared server returned ${response.status}`);
    const result = await response.json();
    setSyncStatus(true);
    return result.state;
  },
};

let state = EMPTY_STATE;
let currentUser = null;
let page = 'home';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

function hasContent(value) {
  return Boolean(value.posts?.length || value.events?.length || value.ideas?.length);
}

function combineStates(remote, local) {
  const combine = (left = [], right = []) => {
    const records = new Map(left.map(item => [String(item.id), item]));
    for (const item of right) {
      const previous = records.get(String(item.id));
      records.set(String(item.id), previous ? {
        ...previous, ...item,
        ...(previous.votes || item.votes ? { votes: { ...previous.votes, ...item.votes } } : {}),
      } : item);
    }
    return [...records.values()];
  };
  return {
    posts: combine(remote.posts, local.posts),
    events: combine(remote.events, local.events),
    ideas: combine(remote.ideas, local.ideas),
  };
}

function setSyncStatus(connected) {
  const title = $('#syncTitle');
  const message = $('#syncMessage');
  const badge = $('#syncBadge');
  if (!title || !message || !badge) return;
  title.textContent = connected ? 'Live circle' : 'Local preview';
  message.textContent = connected ? 'Changes sync across connected devices.' : 'Start the circle server to share posts across devices.';
  badge.innerHTML = `<span class="live-dot${connected ? '' : ' offline'}"></span> FIVE FRIENDS · ${connected ? 'LIVE SYNC' : 'LOCAL PREVIEW'}`;
}

function avatar(name, extra = '') {
  const color = MEMBER_COLOR[name] || 's';
  return `<span class="avatar avatar-${color} ${extra}">${escapeHTML(name?.[0] || '?')}</span>`;
}

function applyIdentity() {
  if (!currentUser) return;
  const profile = $('#profileBtn');
  profile.querySelector('.avatar').className = `avatar avatar-${MEMBER_COLOR[currentUser]}`;
  profile.querySelector('.avatar').textContent = currentUser[0];
  profile.querySelector('b').textContent = currentUser;
  profile.querySelector('small').textContent = 'Posting as';
  $('#welcomeName').textContent = currentUser;
  $('#composerAvatar').className = `avatar avatar-${MEMBER_COLOR[currentUser]}`;
  $('#composerAvatar').textContent = currentUser[0];
  $('#openComposer').textContent = `What’s on your mind, ${currentUser}?`;
}

function showUserPicker() {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="user-picker-backdrop"><section class="user-picker" role="dialog" aria-modal="true" aria-labelledby="pickerTitle">
    <div class="picker-mark">✳</div><div class="eyebrow">CLOSE CIRCLE</div>
    <h2 id="pickerTitle">Who’s here?</h2><p>Choose your name to enter the circle and post as yourself.</p>
    <div class="member-picker">${MEMBERS.map(member => `<button class="member-option" data-user="${member.name}">${avatar(member.name)}<span>${member.name}</span><b>→</b></button>`).join('')}</div>
    <small class="picker-note">This selects a display name in this browser. It isn’t a sign-in or a privacy control.</small>
  </section></div>`;
  root.querySelectorAll('[data-user]').forEach(button => {
    button.onclick = () => {
      currentUser = button.dataset.user;
      root.innerHTML = '';
      applyIdentity();
      render();
    };
  });
}

function save() {
  try {
    stateRepository.write(state);
    render();
    stateRepository.push(state).catch(() => setSyncStatus(false));
  } catch (error) {
    toast('This browser ran out of storage. Try a smaller media file.');
    console.error('Could not save Close Circle data:', error);
  }
}

function relativeDate(value) {
  if (!value) return 'TBD|—';
  const date = new Date(`${value}T12:00:00`);
  return `${date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}|${date.getDate()}`;
}

function render() {
  renderFeed();
  renderEvents();
  renderIdeas();
}

function renderFeed() {
  let posts = state.posts.slice();
  if (page === 'memories') posts = posts.filter(post => post.kind === 'photo' || post.kind === 'video');
  if (page === 'ideas') posts = [];
  if (page === 'hangouts') posts = posts.filter(post => post.kind === 'event');

  $('#feed').innerHTML = posts.length ? posts.map(post => `<article class="post">
    <div class="post-head">${avatar(post.author)}<div><div class="post-author">${escapeHTML(post.author)}</div><div class="post-meta">${escapeHTML(post.time)}</div></div><button class="post-menu" aria-label="More options">•••</button></div>
    <div class="post-copy">${escapeHTML(post.text)}</div>
    ${post.kind === 'photo' ? (post.url ? `<img class="post-photo" src="${post.url}" alt="Photo shared by ${escapeHTML(post.author)}">` : `<div class="post-photo ${post.visual || ''}"></div>`) : ''}
    ${post.kind === 'video' ? (post.url ? `<video class="post-video" src="${post.url}" controls></video>` : `<div class="video-tile"><span>▶</span><small>${escapeHTML(post.fileName || 'Video')}</small></div>`) : ''}
    ${post.kind === 'event' ? eventCard(post.event) : ''}
    <div class="post-actions"><button class="like-button ${post.liked ? 'liked' : ''}" data-like="${post.id}">${post.liked ? '♥' : '♡'} <span>${post.likes || 0}</span></button><button data-comment="${post.id}">◯ ${post.comments || 0} comments</button><span class="spacer"></span><span class="post-reaction">↗</span></div>
  </article>`).join('') : `<div class="empty-state"><span>✳</span>${page === 'ideas' ? 'No ideas yet. Pitch the first one.' : page === 'hangouts' ? 'No hangouts yet. Plan the first one.' : page === 'memories' ? 'No photos or videos yet. Share a moment.' : 'No posts yet. Start the conversation.'}</div>`;
}

function eventCard(event) {
  const choice = event.votes?.[currentUser];
  const date = event.date ? new Date(`${event.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Date to be decided';
  return `<div class="event-inline"><div class="event-inline-top"><span>▦ &nbsp;HANGOUT POLL</span><span>${escapeHTML(event.time || 'TBD')}</span></div><b>${escapeHTML(event.title)}</b><p>${date} · ${escapeHTML(event.place || 'Location TBD')}</p><div class="vote-row">${['I’m in', 'Maybe', 'Can’t make it'].map(choiceText => `<button class="vote-button ${choice === choiceText ? 'chosen' : ''}" data-vote="${event.id}" data-choice="${choiceText}">${choiceText} · ${Object.values(event.votes || {}).filter(vote => vote === choiceText).length}</button>`).join('')}</div></div>`;
}

function renderEvents() {
  const list = $('#eventList');
  const count = $('#hangoutCount');
  if (count) {
    count.textContent = state.events.length;
    count.hidden = state.events.length === 0;
  }
  if (!list) return;
  list.innerHTML = state.events.slice(0, 2).map(event => {
    const [month, day] = relativeDate(event.date).split('|');
    return `<div class="event-row"><span class="date-box"><small>${month}</small><b>${day}</b></span><span class="event-row-info"><b>${escapeHTML(event.title)}</b><small>${escapeHTML(event.time)} · ${escapeHTML(event.place)}</small></span><span class="vote-count">${Object.keys(event.votes || {}).length}/5</span></div>`;
  }).join('') || '<p class="side-empty">No hangouts planned yet.</p>';
}

function renderIdeas() {
  const list = $('#ideaMini');
  if (list) list.innerHTML = state.ideas.slice(0, 3).map(idea => `<div class="idea-item"><b>${escapeHTML(idea.title)}</b><small>from ${escapeHTML(idea.by)} · ${idea.votes || 0} ✧</small></div>`).join('') || '<p class="side-empty">No ideas yet. Pitch the first one.</p>';
  if (page !== 'ideas') return;
  $('#feed').innerHTML = `<div class="idea-board">${state.ideas.map(idea => `<article class="idea-post"><div class="idea-post-top"><span class="idea-star">✧</span><span>GROUP IDEA</span><button data-ideavote="${idea.id}">✧ ${idea.votes || 0}</button></div><h3>${escapeHTML(idea.title)}</h3><p>Put forward by ${escapeHTML(idea.by)}.</p></article>`).join('')}<button class="idea-add" data-compose="idea">＋ Pitch an idea</button></div>`;
  if (!state.ideas.length) $('#feed').innerHTML = `<div class="empty-state"><span>✧</span>No ideas yet. Pitch the first one.</div><button class="idea-add" data-compose="idea">＋ Pitch an idea</button>`;
}

function setPage(nextPage) {
  page = nextPage;
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === nextPage));
  $('#crumbName').textContent = ({ home: 'Home', hangouts: 'Hangouts', ideas: 'Idea board', memories: 'Memories' })[nextPage] || 'Home';
  $('.feed-column h2').textContent = ({ home: 'From your circle', hangouts: 'Hangouts', ideas: 'The idea board', memories: 'Photo & video memories' })[nextPage];
  renderFeed();
  if (nextPage === 'ideas') renderIdeas();
  if (nextPage === 'hangouts') {
    $('#feed').innerHTML = state.events.map(event => `<article class="post"><div class="post-head"><span class="date-box"><small>${relativeDate(event.date).split('|')[0]}</small><b>${relativeDate(event.date).split('|')[1]}</b></span><div><div class="post-author">${escapeHTML(event.title)}</div><div class="post-meta">Proposed by ${escapeHTML(event.by)}</div></div></div><div class="post-copy">${escapeHTML(event.place)} · ${escapeHTML(event.time)}</div>${eventCard(event)}<div class="post-actions">${Object.keys(event.votes || {}).length} of 5 have voted <span class="spacer"></span><span>Poll open</span></div></article>`).join('') || '<div class="empty-state">No hangouts yet. Plan the first one.</div>';
  }
}

function showModal(title, body, submitLabel, onSubmit) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><form class="modal"><div class="modal-head"><h2>${title}</h2><button type="button" class="modal-close" aria-label="Close">×</button></div>${body}<div class="modal-actions"><button type="button" class="btn-secondary modal-cancel">Cancel</button><button class="btn-primary">${submitLabel}</button></div></form></div>`;
  root.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => root.innerHTML = '');
  root.querySelector('.modal-backdrop').addEventListener('click', event => {
    if (event.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
  root.querySelector('form').onsubmit = event => {
    event.preventDefault();
    onSubmit(new FormData(event.target));
    root.innerHTML = '';
  };
}

function openCompose(type = 'post') {
  if (!currentUser) return showUserPicker();
  if (type === 'event') {
    showModal('Plan a hangout', `<p class="modal-help">Suggest a plan and everyone can vote on it.</p><div class="field"><label>What are we doing?</label><input name="title" required placeholder="e.g. Dinner and a movie"></div><div class="field"><label>When?</label><input name="date" type="date" required><input name="time" type="time" value="18:30"></div><div class="field"><label>Where?</label><input name="place" placeholder="A place, or TBD"></div>`, 'Create poll', form => {
      const event = { id: newId(), createdAt: new Date().toISOString(), title: form.get('title'), date: form.get('date'), time: new Date(`2000-01-01T${form.get('time')}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), place: form.get('place') || 'Location TBD', votes: {}, by: currentUser };
      state.events.unshift(event);
      state.posts.unshift({ id: newId(), createdAt: new Date().toISOString(), author: currentUser, time: 'Just now', text: 'New hangout idea—cast your vote!', kind: 'event', event, likes: 0, comments: 0 });
      save(); setPage('hangouts'); toast('Hangout poll is up!');
    });
    return;
  }
  if (type === 'idea') {
    showModal('Pitch an idea', `<p class="modal-help">Big, small, half-baked — put it on the board.</p><div class="field"><label>Your idea</label><input name="idea" required placeholder="e.g. Take a day trip upstate"></div><div class="field"><label>A little more (optional)</label><textarea name="details" placeholder="What makes it sound fun?"></textarea></div>`, 'Add to the board', form => {
      state.ideas.unshift({ id: newId(), createdAt: new Date().toISOString(), title: form.get('idea'), by: currentUser, votes: 0, voters: [], details: form.get('details') });
      save(); setPage('ideas'); toast('Idea added to the board');
    });
    return;
  }
  showModal('Share with your circle', `<div class="field"><label>Say something</label><textarea name="text" placeholder="What’s on your mind?" required></textarea></div><div class="file-drop" id="dropFiles"><strong>▧ &nbsp;Add photos or videos</strong>Choose files from your device · saved in this browser</div><input type="file" name="media" id="modalFile" accept="image/*,video/*" multiple hidden>`, 'Post it', form => {
    const files = Array.from($('#modalFile').files);
    const addPost = (file, url) => state.posts.unshift({ id: newId(), createdAt: new Date().toISOString(), author: currentUser, time: 'Just now', text: form.get('text'), kind: file ? (file.type.startsWith('video') ? 'video' : 'photo') : 'note', url, fileName: file?.name, likes: 0, comments: 0 });
    if (files.length) {
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = () => { addPost(file, reader.result); save(); };
        reader.onerror = () => toast(`Could not read ${file.name}`);
        reader.readAsDataURL(file);
      });
      toast('Saving your post…');
    } else {
      addPost(null, null); save(); toast('Post shared with the circle');
    }
  });
  $('#dropFiles').onclick = () => $('#modalFile').click();
  $('#modalFile').onchange = event => {
    if (event.target.files.length) $('#dropFiles').innerHTML = `<strong>${event.target.files.length} file${event.target.files.length > 1 ? 's' : ''} selected</strong>${Array.from(event.target.files).map(file => escapeHTML(file.name)).join(', ')}`;
  };
}

$$('.nav-item').forEach(button => button.onclick = () => setPage(button.dataset.page));
document.addEventListener('click', event => {
  const compose = event.target.closest('[data-compose]');
  if (compose) openCompose(compose.dataset.compose);
  const voteButton = event.target.closest('[data-vote]');
  if (voteButton && currentUser) {
    const hangout = state.events.find(item => item.id == voteButton.dataset.vote);
    if (hangout) { hangout.votes = hangout.votes || {}; hangout.votes[currentUser] = voteButton.dataset.choice; save(); toast('Your vote is in'); }
  }
  const likeButton = event.target.closest('[data-like]');
  if (likeButton) {
    const post = state.posts.find(item => item.id == likeButton.dataset.like);
    if (post) { post.liked = !post.liked; post.likes = (post.likes || 0) + (post.liked ? 1 : -1); save(); }
  }
  const commentButton = event.target.closest('[data-comment]');
  if (commentButton) toast('Comments are coming in the next version');
  const ideaVote = event.target.closest('[data-ideavote]');
  if (ideaVote && currentUser) {
    const idea = state.ideas.find(item => item.id === ideaVote.dataset.ideavote);
    if (idea) { idea.voters = idea.voters || []; if (!idea.voters.includes(currentUser)) { idea.voters.push(currentUser); idea.votes = idea.voters.length; save(); toast('Vote added'); } }
  }
  const sideLink = event.target.closest('.side-link[data-page]');
  if (sideLink) setPage(sideLink.dataset.page);
});

$('#openComposer').onclick = () => openCompose();
$('#mediaComposer').onclick = () => openCompose();
$('#inviteBtn').onclick = $('#addFriend').onclick = () => toast('Group invites will be available with shared accounts.');
$('#profileBtn').onclick = showUserPicker;
$('#searchBtn').onclick = () => {
  if ($('.search-box')) return $('.search-box').remove();
  const box = document.createElement('div'); box.className = 'search-box'; box.innerHTML = '<input placeholder="Search your circle…" aria-label="Search posts">'; document.body.append(box);
  box.querySelector('input').focus();
  box.querySelector('input').oninput = event => $$('.post').forEach(post => post.style.display = post.textContent.toLowerCase().includes(event.target.value.toLowerCase()) ? '' : 'none');
};
$('#filterBtn').onclick = () => toast('Showing all posts');
$('#loadMore').onclick = () => toast('You’re all caught up');
async function refreshSharedState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Shared server is unavailable');
    const remote = await response.json();
    const shared = remote.state || EMPTY_STATE;
    if (JSON.stringify(shared) !== JSON.stringify(state)) {
      state = shared;
      stateRepository.write(state);
      render();
    }
    setSyncStatus(true);
  } catch {
    setSyncStatus(false);
  }
}

async function startApp() {
  state = await stateRepository.load();
  render();
  showUserPicker();
  setInterval(refreshSharedState, 2500);
}

window.addEventListener('storage', event => {
  if (event.key === stateRepository.key) { state = stateRepository.read(); render(); }
});
window.addEventListener('focus', () => { state = stateRepository.read(); render(); refreshSharedState(); });
startApp();
