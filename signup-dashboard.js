(() => {
  const $ = selector => document.querySelector(selector);
  const config = window.AIRNOTE_SUPABASE;
  const client = window.supabase.createClient(config.url, config.anonKey);
  const login = $('#dashboardLogin');
  const dashboard = $('#dashboard');
  const loginForm = $('#loginForm');
  const loginError = $('#loginError');
  const rows = $('#signupRows');
  let submissions = [];

  const escapeHtml = value => String(value ?? '—').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const formatDate = value => new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'short' }).format(new Date(value));

  function render(list) {
    rows.innerHTML = list.map(item => `<tr>
      <td>${escapeHtml(formatDate(item.submitted_at))}</td><td>${escapeHtml(item.email)}</td>
      <td>${escapeHtml(item.gender)}</td><td>${escapeHtml(item.age_range)}</td>
      <td>${escapeHtml(item.work_role)}</td><td>${escapeHtml(item.primary_use_case)}</td>
      <td>${escapeHtml(item.utm_source || 'Direct')}</td><td>${escapeHtml(item.utm_campaign)}</td><td>${escapeHtml(item.timezone)}</td>
    </tr>`).join('');
    $('#tableCount').textContent = `${list.length} submission${list.length === 1 ? '' : 's'}`;
    $('#emptyState').hidden = list.length > 0;
  }

  async function loadDashboard() {
    const [{ data: signupData, error: signupError }, { data: eventData, error: eventError }] = await Promise.all([
      client.from('early_access_signups').select('*').order('submitted_at', { ascending:false }),
      client.from('early_access_events').select('session_id,event_name,created_at')
    ]);
    if (signupError || eventError) {
      await client.auth.signOut();
      loginError.textContent = 'This account is not approved for dashboard access.';
      login.hidden = false; dashboard.hidden = true; return;
    }
    submissions = signupData || [];
    const starts = new Set((eventData || []).filter(e => e.event_name === 'signup_opened').map(e => e.session_id)).size;
    const paid = submissions.filter(item => ['paid','cpc','ppc','display','social'].includes((item.utm_medium || '').toLowerCase())).length;
    $('#totalSignups').textContent = submissions.length.toLocaleString();
    $('#formStarts').textContent = starts.toLocaleString();
    $('#conversionRate').textContent = starts ? `${Math.round(submissions.length / starts * 100)}%` : '—';
    $('#paidSignups').textContent = paid.toLocaleString();
    render(submissions);
    login.hidden = true; dashboard.hidden = false;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault(); loginError.textContent = '';
    const button = loginForm.querySelector('button'); button.disabled = true; button.textContent = 'Signing in…';
    const { error } = await client.auth.signInWithPassword({ email:$('#adminEmail').value.trim(), password:$('#adminPassword').value });
    button.disabled = false; button.textContent = 'Sign in';
    if (error) { loginError.textContent = 'Email or password not recognised.'; return; }
    loadDashboard();
  });
  $('#signOut').addEventListener('click', async () => { await client.auth.signOut(); location.reload(); });
  $('#signupSearch').addEventListener('input', event => {
    const term = event.target.value.trim().toLowerCase();
    render(!term ? submissions : submissions.filter(item => [item.email,item.work_role,item.primary_use_case,item.utm_source,item.utm_campaign].some(v => (v || '').toLowerCase().includes(term))));
  });
  $('#exportCsv').addEventListener('click', () => {
    const columns = ['submitted_at','email','gender','age_range','work_role','primary_use_case','utm_source','utm_medium','utm_campaign','utm_content','utm_term','landing_page','referrer','timezone','consent_marketing'];
    const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
    const csv = [columns.join(','), ...submissions.map(item => columns.map(col => quote(item[col])).join(','))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
    link.download = `air-note-early-access-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  });
  client.auth.getSession().then(({ data }) => { if (data.session) loadDashboard(); });
})();
