const MEMBERS = [
  { name: 'Sarosh', color: 's' },
  { name: 'Hassan', color: 'h' },
  { name: 'Anthony', color: 'a' },
  { name: 'Jamser', color: 'j' },
  { name: 'Aris', color: 'r' },
];
const MEMBER_COLOR = Object.fromEntries(MEMBERS.map(member => [member.name, member.color]));
const EMPTY_STATE = { posts: [], events: [], ideas: [] };
const MAX_CLOUD_FILE_SIZE = 50 * 1024 * 1024;
const cloudSettings = window.CLOSE_CIRCLE_CONFIG || {};
const cloudClient = cloudSettings.supabaseUrl && cloudSettings.publishableKey && window.supabase?.createClient
  ? window.supabase.createClient(cloudSettings.supabaseUrl, cloudSettings.publishableKey)
  : null;

// Strategy pattern: compress still images, preserve animation, and stream video unchanged.
const mediaUploadStrategies = {
  image: {
    async prepare(file) {
      if (file.type === 'image/gif') return file;
      if (typeof createImageBitmap !== 'function') {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
        const error = new Error('This image format is not supported. Use JPEG, PNG, GIF, or WebP.');
        error.code = 'UNSUPPORTED_IMAGE';
        throw error;
      }
      let bitmap;
      try { bitmap = await createImageBitmap(file); }
      catch {
        const error = new Error('This image format could not be opened. Use JPEG, PNG, GIF, or WebP.');
        error.code = 'UNSUPPORTED_IMAGE';
        throw error;
      }
      try {
        const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
        if (!blob) return file;
        if (blob.size >= file.size && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
        const name = file.name.replace(/\.[^.]+$/, '') || 'circle-photo';
        return new File([blob], `${name}.webp`, { type: 'image/webp', lastModified: file.lastModified });
      } finally {
        bitmap.close?.();
      }
    },
  },
  video: { async prepare(file) { return file; } },
};

// Repository pattern keeps cloud data access separate from views and UI actions.
const stateRepository = {
  async load() {
    if (!cloudClient) {
      setSyncStatus(false);
      return EMPTY_STATE;
    }
    try {
      const { data, error } = await cloudClient.from('circle_state').select('state').eq('id', 'main').maybeSingle();
      if (error) throw error;
      if (data?.state) {
        setSyncStatus(true);
        return data.state;
      }
      return await this.push(EMPTY_STATE);
    } catch (error) {
      setSyncStatus(false);
      console.error('Could not load the shared circle:', error);
      return EMPTY_STATE;
    }
  },
  async push(value) {
    if (!cloudClient) throw new Error('Cloud storage is not configured');
    const { data, error } = await cloudClient.rpc('merge_circle_state', { incoming_state: value });
    if (error) throw error;
    setSyncStatus(true);
    return data;
  },
  async uploadMedia(file) {
    if (!cloudClient) throw new Error('Cloud media storage is not configured');
    const strategy = file.type.startsWith('image/') ? mediaUploadStrategies.image : mediaUploadStrategies.video;
    const preparedFile = await strategy.prepare(file);
    if (preparedFile.size > MAX_CLOUD_FILE_SIZE) {
      const error = new Error('This file is over the 50 MB upload limit. Choose a smaller video or compress it first.');
      error.code = 'FILE_TOO_LARGE';
      throw error;
    }
    const bucket = cloudSettings.storageBucket || 'circle-media';
    const safeName = preparedFile.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'upload';
    const path = `${newId()}-${safeName}`;
    const { error } = await cloudClient.storage.from(bucket).upload(path, preparedFile, { contentType: preparedFile.type, upsert: false });
    if (error) throw error;
    return { url: cloudClient.storage.from(bucket).getPublicUrl(path).data.publicUrl, storedName: preparedFile.name, path };
  },
  async removeMedia(paths) {
    if (!cloudClient || !paths.length) return;
    const bucket = cloudSettings.storageBucket || 'circle-media';
    const { error } = await cloudClient.storage.from(bucket).remove(paths);
    if (error) throw error;
  },
};

let state = EMPTY_STATE;
let currentUser = null;
let page = 'home';
let latestSave = 0;
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

function friendlyCloudError(error) {
  const detail = `${error?.code || ''} ${error?.statusCode || ''} ${error?.message || ''}`.toLowerCase();
  if (error?.code === 'UNSUPPORTED_IMAGE') return error.message;
  if (error?.code === 'FILE_TOO_LARGE' || /entitytoolarge|max-file-limit|413/.test(detail)) {
    return 'This file is over the 50 MB limit. Choose a smaller video or compress it first.';
  }
  if (/exceed_storage_size_quota|storage.*quota|quota.*storage|database.*size.*limit|quota.*exceed|storage.*full/.test(detail)) {
    return 'Cloud storage is full. Remove older media in Supabase Storage to free space before uploading more.';
  }
  return 'Could not save to the shared cloud. Check the connection and try again.';
}

function setSyncStatus(connected) {
  const title = $('#syncTitle');
  const message = $('#syncMessage');
  const badge = $('#syncBadge');
  if (!title || !message || !badge) return;
  title.textContent = connected ? 'Live circle' : cloudClient ? 'Reconnecting to cloud' : 'Cloud setup pending';
  message.textContent = connected ? 'Posts and media sync across devices.' : cloudClient ? 'Trying to reconnect to shared posts.' : 'Connect the shared cloud database to start posting.';
  badge.innerHTML = `<span class="live-dot${connected ? '' : ' offline'}"></span> FIVE FRIENDS · ${connected ? 'LIVE SYNC' : 'CLOUD NOT CONNECTED'}`;
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
  if (!cloudClient) {
    toast('Cloud setup is not complete yet');
    return;
  }
  try {
    render();
    const saveNumber = ++latestSave;
    stateRepository.push(state).then(shared => {
      if (saveNumber === latestSave) { state = shared; render(); }
    }).catch(error => {
      setSyncStatus(false);
      toast(friendlyCloudError(error));
      console.error('Could not save Close Circle data:', error);
    });
  } catch (error) {
    toast(friendlyCloudError(error));
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
    ${post.kind === 'photo' ? (post.url ? `<div class="post-media-frame"><img class="post-photo" src="${post.url}" alt="Photo shared by ${escapeHTML(post.author)}"></div>` : `<div class="post-media-frame post-photo ${post.visual || ''}"></div>`) : ''}
    ${post.kind === 'video' ? (post.url ? `<div class="post-media-frame video-frame"><video class="post-video" src="${post.url}" controls playsinline preload="metadata"></video></div>` : `<div class="post-media-frame video-frame"><div class="video-tile"><span>▶</span><small>${escapeHTML(post.fileName || 'Video')}</small></div></div>`) : ''}
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
  showModal('Share with your circle', `<div class="field"><label>Say something</label><textarea name="text" placeholder="What’s on your mind?" required></textarea></div><div class="file-drop" id="dropFiles"><strong>▧ &nbsp;Add photos or videos</strong>Photos are optimized · MP4/WebM videos up to 50 MB</div><input type="file" name="media" id="modalFile" accept="image/*,video/mp4,video/webm" multiple hidden>`, 'Post it', form => {
    const files = Array.from($('#modalFile').files);
    const addPost = (file, url) => state.posts.unshift({ id: newId(), createdAt: new Date().toISOString(), author: currentUser, time: 'Just now', text: form.get('text'), kind: file ? (file.type.startsWith('video') ? 'video' : 'photo') : 'note', url, fileName: file?.name, likes: 0, comments: 0 });
    if (files.length) {
      (async () => {
        const uploads = [];
        try {
          for (const file of files) uploads.push({ file, ...(await stateRepository.uploadMedia(file)) });
          uploads.forEach(({ file, url }) => addPost(file, url));
          save();
          toast('Media shared with the circle');
        } catch (error) {
          try { await stateRepository.removeMedia(uploads.map(upload => upload.path)); }
          catch (cleanupError) { console.error('Could not remove incomplete media upload:', cleanupError); }
          toast(friendlyCloudError(error));
          console.error('Could not upload Close Circle media:', error);
        }
      })();
      toast('Optimizing and uploading to shared media storage…');
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
  if (!cloudClient) return;
  try {
    const { data, error } = await cloudClient.from('circle_state').select('state').eq('id', 'main').maybeSingle();
    if (error) throw error;
    const shared = data?.state || EMPTY_STATE;
    if (JSON.stringify(shared) !== JSON.stringify(state)) {
      state = shared;
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
  if (cloudClient) {
    cloudClient.channel('circle-state-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_state', filter: 'id=eq.main' }, payload => {
        const shared = payload.new?.state;
        if (shared && JSON.stringify(shared) !== JSON.stringify(state)) { state = shared; render(); }
      })
      .subscribe(status => setSyncStatus(status === 'SUBSCRIBED'));
    setInterval(refreshSharedState, 15000);
  }
}

window.addEventListener('focus', refreshSharedState);
startApp();
