// AssetNest web dashboard. Plain ES modules, no build step.
// The API works in minor units (cents); forms take major units and convert.

const state = { orgs: [], org: null, ref: null, pricing: null };
const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
const dialogBody = document.getElementById('dialog-body');

// ---------------------------------------------------------------- helpers

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(minor, currency = state.org?.currency ?? 'USD') {
  if (minor == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}
const toMinor = (major) => (major === '' || major == null ? undefined : Math.round(Number(major) * 100));
const label = (code) => String(code ?? '').replaceAll('_', ' ');
const badge = (status) => `<span class="badge ${esc(status)}">${esc(label(status))}</span>`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ''), isError ? 6000 : 3000);
}

function table(columns, rows, { onRow, empty = 'Nothing here yet.' } = {}) {
  if (!rows.length) return `<div class="panel"><div class="empty">${esc(empty)}</div></div>`;
  const head = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows
    .map((row, i) => `<tr data-i="${i}" class="${onRow ? 'clickable' : ''}">${columns
      .map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(row) : esc(c.value ? c.value(row) : row[c.key])}</td>`)
      .join('')}</tr>`)
    .join('');
  const id = `t${Math.random().toString(36).slice(2)}`;
  if (onRow) {
    queueMicrotask(() => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-i]');
        if (tr) onRow(rows[Number(tr.dataset.i)]);
      });
    });
  }
  return `<div class="panel"><table id="${id}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function card(labelText, value, hint = '') {
  return `<div class="card"><div class="label">${esc(labelText)}</div><div class="value">${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}

function showDialog(html) {
  dialogBody.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  const closers = dialogBody.querySelectorAll('[data-close]');
  closers.forEach((b) => b.addEventListener('click', () => dialog.close()));
  // Start on the first form field, or Close, never on a destructive button.
  (dialogBody.querySelector('input, select, textarea') ?? closers[closers.length - 1])?.focus();
}

/**
 * Opens a form in the dialog. fields: { name, label, type, options, value, required, full, step }
 * type: text | number | money | percent | date | select | checkbox | textarea
 */
function openForm({ title, fields, submitLabel = 'Save', onSubmit, extraHtml = '' }) {
  const input = (f) => {
    const req = f.required ? 'required' : '';
    const value = f.value ?? '';
    if (f.type === 'select') {
      const opts = f.options.map((o) => {
        const [v, text] = Array.isArray(o) ? o : [o, label(o)];
        return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
      }).join('');
      return `<select name="${f.name}" ${req}>${f.required ? '' : '<option value=""></option>'}${opts}</select>`;
    }
    if (f.type === 'checkbox') return `<input type="checkbox" name="${f.name}" ${value ? 'checked' : ''}>`;
    if (f.type === 'textarea') return `<textarea name="${f.name}" rows="3" ${req}>${esc(value)}</textarea>`;
    const type = ['money', 'percent', 'number'].includes(f.type) ? 'number' : f.type ?? 'text';
    const step = f.step ?? (f.type === 'money' ? '0.01' : 'any');
    return `<input type="${type}" name="${f.name}" value="${esc(value)}" ${type === 'number' ? `step="${step}"` : ''} ${req}>`;
  };
  showDialog(`
    <h2>${esc(title)}</h2>
    <form class="grid" id="dlg-form">
      ${fields.map((f) => `<label class="${f.full ? 'full' : ''}">${esc(f.label)}${input(f)}</label>`).join('')}
      ${extraHtml}
      <div class="form-actions full">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`);
  document.getElementById('dlg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.type === 'checkbox') data[f.name] = el.checked;
      else if (el.value === '') continue;
      else if (f.type === 'money') data[f.name] = toMinor(el.value);
      else if (['number', 'percent'].includes(f.type)) data[f.name] = Number(el.value);
      else data[f.name] = el.value;
    }
    try {
      await onSubmit(data, form);
      dialog.close();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------------------------------------------------------- views

const views = {};

views.dashboard = async () => {
  const d = await api(`/organizations/${state.org.id}/dashboard`);
  const sub = d.subscription;
  view.innerHTML = `
    <h1>${esc(d.organization.name)}</h1>
    <p class="sub">As of ${esc(d.as_of)} · ${esc(state.pricing.plans[d.organization.plan].name)} plan</p>
    <div class="cards">
      ${card('Occupancy', `${d.occupancy_rate}%`, `${d.occupied_units} of ${d.units} units let`)}
      ${card('Monthly rent roll', money(d.monthly_rent_roll), `${d.properties} properties`)}
      ${card('Billed this month', money(d.billed_this_month))}
      ${card('Collected this month', money(d.collected_this_month), d.collection_rate != null ? `${d.collection_rate}% of billed` : '')}
      ${card('Arrears (overdue)', money(d.arrears), `${money(d.outstanding)} outstanding in total`)}
      ${card('Open maintenance', d.open_maintenance)}
    </div>
    <div class="two-col">
      <div>
        <h2>Occupancy by property</h2>
        ${table([
          { label: 'Property', key: 'name' },
          { label: 'Type', value: (r) => label(r.type) },
          { label: 'Units', key: 'units', num: true },
          { label: 'Let', key: 'occupied', num: true },
          { label: 'Occupancy', num: true, value: (r) => (r.units ? `${Math.round((r.occupied / r.units) * 100)}%` : '—') },
        ], d.by_property)}
        <h2>Leases expiring in 90 days</h2>
        ${table([
          { label: 'Tenant', key: 'tenant_name' },
          { label: 'Unit', key: 'unit_label' },
          { label: 'Ends', key: 'end_date' },
        ], d.leases_expiring_90_days, { empty: 'No leases expiring soon.' })}
      </div>
      <div>
        <h2>Top arrears</h2>
        ${table([
          { label: 'Tenant', key: 'name' },
          { label: 'Overdue', num: true, value: (r) => money(r.overdue) },
        ], d.top_arrears, { empty: 'No overdue balances.', onRow: (r) => showStatement(r.id) })}
        <h2>Your AssetNest subscription</h2>
        <div class="panel" style="padding:14px 16px">
          ${sub.lines.map((l) => `<div>${esc(l.description)}${l.quantity > 1 ? ` × ${l.quantity}` : ''} <span class="muted">· ${money(l.amount, sub.currency)}/mo</span></div>`).join('')}
          <p><strong>${money(sub.recurringTotal, sub.currency)}</strong> per ${sub.cycle === 'annual' ? 'year' : 'month'}
          ${sub.annualSavings ? `<span class="muted">(saves ${money(sub.annualSavings, sub.currency)} vs monthly)</span>` : ''}</p>
          <p class="muted">Online payment fee: ${sub.onlinePaymentFeePercent}% on cards. Platform fees this month: ${money(sub.platform_fees_this_month)}</p>
          ${sub.warnings.map((w) => `<p class="warning">${esc(w)}</p>`).join('')}
        </div>
      </div>
    </div>`;
};

views.properties = async () => {
  const [props, unitRows] = await Promise.all([
    api(`/properties?${qs({ org_id: state.org.id })}`),
    api(`/units?${qs({ org_id: state.org.id })}`),
  ]);
  const unitCols = [
    { label: 'Unit', key: 'label' },
    { label: 'Type', value: (r) => label(r.type) },
    { label: 'Floor', key: 'floor' },
    { label: 'Area', num: true, value: (r) => r.area ?? '' },
    { label: 'Market rent', num: true, value: (r) => money(r.market_rent) },
    { label: 'Status', html: (r) => badge(r.occupied ? 'occupied' : 'vacant') },
  ];
  view.innerHTML = `
    <h1>Properties &amp; units</h1>
    <p class="sub">Malls, office blocks, apartments, warehouses: any property, any rentable space.</p>
    <div class="toolbar">
      <button class="btn primary" id="add-property">Add property</button>
      <button class="btn" id="add-unit" ${props.length ? '' : 'disabled'}>Add unit</button>
    </div>
    ${props.length ? '' : '<div class="panel"><div class="empty">Add your first property to get started.</div></div>'}
    ${props.map((p) => `
      <h2>${esc(p.name)} <span class="muted">· ${esc(label(p.type))}${p.city ? ` · ${esc(p.city)}` : ''} · area in ${esc(p.area_unit)}</span></h2>
      ${table(unitCols, unitRows.filter((u) => u.property_id === p.id), { empty: 'No units yet.', onRow: editUnit })}`).join('')}`;

  document.getElementById('add-property').onclick = () => openForm({
    title: 'Add property',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'type', label: 'Type', type: 'select', options: state.ref.property_types, required: true },
      { name: 'address', label: 'Address' },
      { name: 'city', label: 'City' },
      { name: 'country', label: 'Country' },
      { name: 'area_unit', label: 'Measure area in', type: 'select', options: [['sqft', 'Square feet'], ['m2', 'Square metres']], value: 'sqft', required: true },
    ],
    onSubmit: async (data) => {
      await api('/properties', { method: 'POST', body: { ...data, org_id: state.org.id } });
      toast('Property added');
      render();
    },
  });
  document.getElementById('add-unit').onclick = () => openForm({
    title: 'Add unit',
    fields: [
      { name: 'property_id', label: 'Property', type: 'select', options: props.map((p) => [p.id, p.name]), required: true },
      { name: 'label', label: 'Unit name / number', required: true },
      { name: 'type', label: 'Type', type: 'select', options: state.ref.unit_types, required: true },
      { name: 'floor', label: 'Floor' },
      { name: 'area', label: 'Area', type: 'number' },
      { name: 'bedrooms', label: 'Bedrooms', type: 'number', step: '1' },
      { name: 'market_rent', label: 'Market rent / month', type: 'money' },
    ],
    onSubmit: async (data) => {
      await api('/units', { method: 'POST', body: { ...data, property_id: Number(data.property_id) } });
      toast('Unit added');
      render();
    },
  });
};

function editUnit(unit) {
  openForm({
    title: `Edit unit ${unit.label}`,
    fields: [
      { name: 'label', label: 'Unit name / number', value: unit.label, required: true },
      { name: 'type', label: 'Type', type: 'select', options: state.ref.unit_types, value: unit.type, required: true },
      { name: 'floor', label: 'Floor', value: unit.floor },
      { name: 'area', label: 'Area', type: 'number', value: unit.area },
      { name: 'market_rent', label: 'Market rent / month', type: 'money', value: unit.market_rent != null ? unit.market_rent / 100 : '' },
    ],
    onSubmit: async (data) => {
      await api(`/units/${unit.id}`, { method: 'PATCH', body: data });
      toast('Unit updated');
      render();
    },
  });
}

views.tenants = async () => {
  const rows = await api(`/tenants?${qs({ org_id: state.org.id })}`);
  view.innerHTML = `
    <h1>Tenants</h1>
    <p class="sub">Individuals and businesses. Click a tenant for their statement.</p>
    <div class="toolbar"><button class="btn primary" id="add-tenant">Add tenant</button></div>
    ${table([
      { label: 'Name', key: 'name' },
      { label: 'Type', key: 'kind' },
      { label: 'Contact', value: (r) => r.contact_person ?? '' },
      { label: 'Email', key: 'email' },
      { label: 'Phone', key: 'phone' },
    ], rows, { onRow: (r) => showStatement(r.id) })}`;
  document.getElementById('add-tenant').onclick = () => openForm({
    title: 'Add tenant',
    fields: [
      { name: 'name', label: 'Name / business name', required: true },
      { name: 'kind', label: 'Type', type: 'select', options: ['individual', 'business'], value: 'individual', required: true },
      { name: 'contact_person', label: 'Contact person' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone' },
      { name: 'id_number', label: 'ID / registration no.' },
      { name: 'tax_id', label: 'Tax ID / PIN' },
    ],
    onSubmit: async (data) => {
      await api('/tenants', { method: 'POST', body: { ...data, org_id: state.org.id } });
      toast('Tenant added');
      render();
    },
  });
};

async function showStatement(tenantId) {
  const s = await api(`/tenants/${tenantId}/statement`);
  showDialog(`
    <h2>${esc(s.tenant.name)}</h2>
    <p class="sub">Balance <strong>${money(s.balance, s.currency)}</strong>${s.overdue ? ` · <span class="badge overdue">${money(s.overdue, s.currency)} overdue</span>` : ''}${s.balance < 0 ? ' (in credit)' : ''}</p>
    ${table([
      { label: 'Unit', value: (l) => `${l.property_name} · ${l.unit_label}` },
      { label: 'From', key: 'start_date' },
      { label: 'To', value: (l) => l.end_date ?? 'open-ended' },
      { label: 'Rent', num: true, value: (l) => money(l.rent_amount, s.currency) },
      { label: 'Status', html: (l) => badge(l.status) },
    ], s.leases, { empty: 'No leases.' })}
    <h2>Statement</h2>
    ${table([
      { label: 'Date', key: 'date' },
      { label: 'Reference', key: 'reference' },
      { label: 'Description', key: 'description' },
      { label: 'Charges', num: true, value: (e) => (e.debit ? money(e.debit, s.currency) : '') },
      { label: 'Payments', num: true, value: (e) => (e.credit ? money(e.credit, s.currency) : '') },
      { label: 'Balance', num: true, value: (e) => money(e.balance, s.currency) },
    ], s.entries, { empty: 'No transactions yet.' })}
    <div class="form-actions"><button class="btn" data-close>Close</button></div>`);
}

views.leases = async () => {
  const rows = await api(`/leases?${qs({ org_id: state.org.id })}`);
  view.innerHTML = `
    <h1>Leases</h1>
    <p class="sub">Rent, deposits, escalations and every recurring charge. Click a lease to manage its charges.</p>
    <div class="toolbar"><button class="btn primary" id="add-lease">New lease</button></div>
    ${table([
      { label: 'Tenant', key: 'tenant_name' },
      { label: 'Unit', value: (r) => `${r.property_name} · ${r.unit_label}` },
      { label: 'Start', key: 'start_date' },
      { label: 'End', value: (r) => r.terminated_on ?? r.end_date ?? 'open-ended' },
      { label: 'Rent / month', num: true, value: (r) => money(r.rent_amount) },
      { label: 'VAT', value: (r) => (r.vat_applicable ? 'Yes' : 'No') },
      { label: 'Status', html: (r) => badge(r.status) },
    ], rows, { onRow: (r) => showLease(r.id) })}`;
  document.getElementById('add-lease').onclick = newLeaseForm;
};

function chargeValueToBody(method, value) {
  if (value === '' || value == null) return null;
  if (method === 'fixed') return { amount: toMinor(value) };
  if (['per_area', 'metered'].includes(method)) return { rate: Number(value) * 100 };
  return { rate: Number(value) };
}

const methodHint = {
  fixed: 'amount per month',
  per_area: 'rate per sq ft / m² per month',
  percent_of_rent: '% of rent',
  metered: 'rate per meter unit',
  turnover: '% of gross sales',
};

function chargeRowsHtml(count) {
  const typeOpts = Object.entries(state.ref.charge_types).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  const methodOpts = Object.keys(state.ref.methods).map((m) => `<option value="${m}">${esc(label(m))} (${esc(methodHint[m])})</option>`).join('');
  return Array.from({ length: count }, (_, i) => `
    <fieldset class="full charge-row">
      <legend>Extra charge ${i + 1} (optional)</legend>
      <div class="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        <select name="c_type_${i}"><option value=""></option>${typeOpts}</select>
        <select name="c_method_${i}">${methodOpts}</select>
        <input type="number" step="any" name="c_value_${i}" placeholder="amount / rate">
      </div>
    </fieldset>`).join('');
}

function readChargeRows(form, count) {
  const charges = [];
  for (let i = 0; i < count; i++) {
    const type = form.elements[`c_type_${i}`].value;
    if (!type) continue;
    const method = form.elements[`c_method_${i}`].value;
    const value = chargeValueToBody(method, form.elements[`c_value_${i}`].value);
    if (!value) throw new Error(`Enter an amount or rate for extra charge ${i + 1}`);
    charges.push({ charge_type: type, method, ...value });
  }
  return charges;
}

async function newLeaseForm() {
  const [unitRows, tenantRows] = await Promise.all([
    api(`/units?${qs({ org_id: state.org.id })}`),
    api(`/tenants?${qs({ org_id: state.org.id })}`),
  ]);
  if (!unitRows.length || !tenantRows.length) return toast('Add a unit and a tenant first', true);
  const CHARGE_ROWS = 4;
  openForm({
    title: 'New lease',
    fields: [
      { name: 'unit_id', label: 'Unit', type: 'select', required: true, options: unitRows.map((u) => [u.id, `${u.property_name} · ${u.label}${u.occupied ? ' (occupied)' : ''}`]) },
      { name: 'tenant_id', label: 'Tenant', type: 'select', required: true, options: tenantRows.map((t) => [t.id, t.name]) },
      { name: 'start_date', label: 'Start date', type: 'date', value: todayIso(), required: true },
      { name: 'end_date', label: 'End date (blank = open-ended)', type: 'date' },
      { name: 'rent_amount', label: 'Rent per month', type: 'money', required: true },
      { name: 'deposit_amount', label: 'Security deposit', type: 'money' },
      { name: 'due_day', label: 'Rent due on day', type: 'number', step: '1', value: 5 },
      { name: 'escalation_rate', label: 'Annual escalation %', type: 'percent', value: 0 },
      { name: 'vat_applicable', label: 'Charge VAT (commercial lease)', type: 'checkbox' },
    ],
    extraHtml: chargeRowsHtml(CHARGE_ROWS),
    submitLabel: 'Create lease',
    onSubmit: async (data, form) => {
      const body = { ...data, unit_id: Number(data.unit_id), tenant_id: Number(data.tenant_id), charges: readChargeRows(form, CHARGE_ROWS) };
      await api('/leases', { method: 'POST', body });
      toast('Lease created');
      render();
    },
  });
}

function describeCharge(c) {
  switch (c.method) {
    case 'fixed': return `${money(c.amount)} / month`;
    case 'per_area': return `${money(c.rate)} per area unit / month`;
    case 'percent_of_rent': return `${c.rate}% of rent`;
    case 'metered': return `${money(c.rate)} per meter unit`;
    case 'turnover': return `${c.rate}% of sales${c.breakpoint != null ? ` above ${money(c.breakpoint)}` : ' above base rent'}`;
    default: return c.method;
  }
}

async function showLease(id) {
  const lease = await api(`/leases/${id}`);
  const name = (c) => c.description || state.ref.charge_types[c.charge_type]?.name || c.charge_type;
  showDialog(`
    <h2>${esc(lease.tenant_name)} · ${esc(lease.property_name)} ${esc(lease.unit_label)}</h2>
    <p class="sub">${esc(lease.start_date)} to ${esc(lease.terminated_on ?? lease.end_date ?? 'open-ended')} · ${badge(lease.status)}</p>
    <div class="cards">
      ${card('Rent / month', money(lease.rent_amount), lease.escalation_rate ? `+${lease.escalation_rate}% every ${lease.escalation_interval_months} months` : 'No escalation')}
      ${card('Deposit', money(lease.deposit_amount))}
      ${card('Due day', lease.due_day)}
      ${card('VAT', lease.vat_applicable ? 'Applies' : 'Exempt')}
    </div>
    <h2>Recurring charges</h2>
    ${table([
      { label: 'Charge', value: name },
      { label: 'Calculation', value: describeCharge },
      { label: '', html: (c) => `${c.method === 'metered' ? `<button class="btn" data-reading="${c.id}">Meter reading</button>` : ''}
          ${c.method === 'turnover' ? `<button class="btn" data-sales="${c.id}">Report sales</button>` : ''}
          <button class="btn danger" data-remove="${c.id}">Remove</button>` },
    ], lease.charges, { empty: 'Rent only.' })}
    <div class="form-actions">
      <button class="btn" id="lease-add-charge">Add recurring charge</button>
      <button class="btn" id="lease-one-off">Add one-off charge</button>
      ${lease.status === 'active' ? '<button class="btn danger" id="lease-terminate">Terminate</button>' : ''}
      <button class="btn" data-close>Close</button>
    </div>`);

  const refresh = () => showLease(id);
  dialogBody.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this charge from future invoices?')) return;
    await api(`/leases/${id}/charges/${b.dataset.remove}`, { method: 'DELETE' });
    toast('Charge removed');
    refresh();
  }));
  dialogBody.querySelectorAll('[data-reading]').forEach((b) => (b.onclick = () => openForm({
    title: 'Record meter reading',
    fields: [
      { name: 'period', label: 'Billing month (YYYY-MM)', value: todayIso().slice(0, 7), required: true },
      { name: 'previous_reading', label: 'Previous reading', type: 'number', required: true },
      { name: 'current_reading', label: 'Current reading', type: 'number', required: true },
      { name: 'read_on', label: 'Read on', type: 'date', value: todayIso() },
    ],
    onSubmit: async (data) => {
      await api('/meter-readings', { method: 'POST', body: { ...data, lease_charge_id: Number(b.dataset.reading) } });
      toast('Reading saved; it will be billed in that month');
    },
  })));
  dialogBody.querySelectorAll('[data-sales]').forEach((b) => (b.onclick = () => openForm({
    title: 'Report gross sales',
    fields: [
      { name: 'period', label: 'Sales month (YYYY-MM)', value: todayIso().slice(0, 7), required: true },
      { name: 'gross_sales', label: 'Gross sales', type: 'money', required: true },
    ],
    onSubmit: async (data) => {
      await api('/sales-reports', { method: 'POST', body: { ...data, lease_id: id } });
      toast('Sales saved; turnover rent is billed the following month');
    },
  })));
  document.getElementById('lease-add-charge').onclick = () => openForm({
    title: 'Add recurring charge',
    fields: [
      { name: 'charge_type', label: 'Charge', type: 'select', required: true, options: Object.entries(state.ref.charge_types).map(([k, v]) => [k, v.name]) },
      { name: 'method', label: 'Calculation', type: 'select', required: true, options: Object.keys(state.ref.methods).map((m) => [m, `${label(m)} (${methodHint[m]})`]) },
      { name: 'value', label: 'Amount / rate', type: 'number', required: true },
      { name: 'description', label: 'Description (optional)' },
    ],
    onSubmit: async (data) => {
      const body = { charge_type: data.charge_type, method: data.method, description: data.description, ...chargeValueToBody(data.method, data.value) };
      await api(`/leases/${id}/charges`, { method: 'POST', body });
      toast('Charge added');
      refresh();
    },
  });
  document.getElementById('lease-one-off').onclick = () => openForm({
    title: 'Add one-off charge',
    fields: [
      { name: 'charge_type', label: 'Charge', type: 'select', required: true, options: Object.entries(state.ref.charge_types).map(([k, v]) => [k, v.name]) },
      { name: 'amount', label: 'Amount', type: 'money', required: true },
      { name: 'description', label: 'Description' },
      { name: 'charge_date', label: 'Date', type: 'date', value: todayIso() },
    ],
    onSubmit: async (data) => {
      await api('/one-time-charges', { method: 'POST', body: { ...data, lease_id: id } });
      toast('Charge added to the next invoice');
    },
  });
  document.getElementById('lease-terminate')?.addEventListener('click', () => openForm({
    title: 'Terminate lease',
    fields: [
      { name: 'terminated_on', label: 'Last day of tenancy', type: 'date', value: todayIso(), required: true },
      { name: 'move_out_fee', label: 'Move-out fee (optional)', type: 'money' },
    ],
    submitLabel: 'Terminate',
    onSubmit: async (data) => {
      await api(`/leases/${id}/terminate`, { method: 'POST', body: data });
      toast('Lease terminated; the last month will be prorated');
      render();
    },
  }));
}

views.invoices = async () => {
  const status = new URLSearchParams(location.hash.split('?')[1]).get('status') ?? '';
  const rows = await api(`/invoices?${qs({ org_id: state.org.id, status })}`);
  const now = todayIso().slice(0, 7);
  view.innerHTML = `
    <h1>Invoices</h1>
    <p class="sub">Run billing once a month. It is safe to re-run: leases already invoiced are skipped.</p>
    <div class="toolbar">
      <label>Month <input type="month" id="bill-month" value="${now}"></label>
      <button class="btn primary" id="run-billing">Generate invoices</button>
      <button class="btn" id="late-fees">Apply late fees</button>
      <label>Status
        <select id="status-filter">
          ${['', 'open', 'partial', 'paid', 'void'].map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s || 'All'}</option>`).join('')}
        </select>
      </label>
    </div>
    ${table([
      { label: 'Number', key: 'number' },
      { label: 'Month', key: 'period' },
      { label: 'Tenant', key: 'tenant_name' },
      { label: 'Unit', value: (r) => `${r.property_name} · ${r.unit_label}` },
      { label: 'Due', key: 'due_date' },
      { label: 'Total', num: true, value: (r) => money(r.total) },
      { label: 'Balance', num: true, value: (r) => money(r.balance) },
      { label: 'Status', html: (r) => badge(r.status !== 'paid' && r.status !== 'void' && r.due_date < todayIso() ? 'overdue' : r.status) },
    ], rows, { onRow: (r) => showInvoice(r.id) })}`;

  document.getElementById('status-filter').onchange = (e) => {
    location.hash = e.target.value ? `invoices?status=${e.target.value}` : 'invoices';
  };
  document.getElementById('run-billing').onclick = async () => {
    const [year, month] = document.getElementById('bill-month').value.split('-').map(Number);
    try {
      const r = await api('/billing/run', { method: 'POST', body: { org_id: state.org.id, year, month } });
      toast(`${r.created.length} invoice(s) created, ${r.skipped.length} skipped${r.warnings.length ? `. ${r.warnings.join(' ')}` : ''}`, r.warnings.length > 0);
      render();
    } catch (err) {
      toast(err.message, true);
    }
  };
  document.getElementById('late-fees').onclick = async () => {
    try {
      const r = await api('/billing/late-fees', { method: 'POST', body: { org_id: state.org.id } });
      toast(r.assessed.length ? `${r.assessed.length} late fee(s) added to next invoices` : 'No late fees due');
    } catch (err) {
      toast(err.message, true);
    }
  };
};

async function showInvoice(id) {
  const inv = await api(`/invoices/${id}`);
  showDialog(`
    <h2>Invoice ${esc(inv.number)}</h2>
    <p class="sub">${esc(inv.tenant_name)} · ${esc(inv.property_name)} ${esc(inv.unit_label)} · issued ${esc(inv.issue_date)} · due ${esc(inv.due_date)} · ${badge(inv.status)}</p>
    ${table([
      { label: 'Description', key: 'description' },
      ...(inv.tax > 0 ? [{ label: 'VAT', value: (l) => (l.taxable ? 'Yes' : '') }] : []),
      { label: 'Amount', num: true, value: (l) => money(l.amount) },
    ], inv.lines)}
    <div class="panel" style="padding:12px 16px;margin-top:8px">
      <div>Subtotal <strong style="float:right">${money(inv.subtotal)}</strong></div>
      <div>VAT <strong style="float:right">${money(inv.tax)}</strong></div>
      <div>Total <strong style="float:right">${money(inv.total)}</strong></div>
      <div>Paid <strong style="float:right">${money(inv.amount_paid)}</strong></div>
      <div>Balance <strong style="float:right">${money(inv.balance)}</strong></div>
    </div>
    ${inv.payments.length ? `<h2>Payments applied</h2>${table([
      { label: 'Date', key: 'paid_on' },
      { label: 'Method', value: (p) => label(p.method) },
      { label: 'Reference', key: 'reference' },
      { label: 'Applied', num: true, value: (p) => money(p.amount) },
    ], inv.payments)}` : ''}
    <div class="form-actions">
      ${inv.status === 'open' ? '<button class="btn danger" id="void-invoice">Void</button>' : ''}
      <button class="btn" onclick="window.print()">Print</button>
      <button class="btn" data-close>Close</button>
    </div>`);
  document.getElementById('void-invoice')?.addEventListener('click', async () => {
    if (!confirm(`Void ${inv.number}? You can then generate the month again.`)) return;
    try {
      await api(`/invoices/${id}/void`, { method: 'POST' });
      dialog.close();
      toast('Invoice voided');
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

views.payments = async () => {
  const rows = await api(`/payments?${qs({ org_id: state.org.id })}`);
  view.innerHTML = `
    <h1>Payments</h1>
    <p class="sub">Payments are applied to the tenant's oldest unpaid invoice first; any excess is kept as credit.</p>
    <div class="toolbar"><button class="btn primary" id="add-payment">Record payment</button></div>
    ${table([
      { label: 'Date', key: 'paid_on' },
      { label: 'Tenant', key: 'tenant_name' },
      { label: 'Method', value: (r) => label(r.method) },
      { label: 'Reference', key: 'reference' },
      { label: 'Amount', num: true, value: (r) => money(r.amount) },
      { label: 'Unapplied credit', num: true, value: (r) => (r.unallocated ? money(r.unallocated) : '') },
      { label: 'AssetNest fee', num: true, value: (r) => (r.platform_fee ? money(r.platform_fee) : '') },
    ], rows, { onRow: (r) => showStatement(r.tenant_id) })}`;
  document.getElementById('add-payment').onclick = async () => {
    const tenantRows = await api(`/tenants?${qs({ org_id: state.org.id })}`);
    openForm({
      title: 'Record payment',
      fields: [
        { name: 'tenant_id', label: 'Tenant', type: 'select', required: true, options: tenantRows.map((t) => [t.id, t.name]) },
        { name: 'amount', label: 'Amount', type: 'money', required: true },
        { name: 'method', label: 'Method', type: 'select', required: true, options: Object.entries(state.pricing.transaction_fees).map(([k, v]) => [k, v.name]) },
        { name: 'reference', label: 'Reference (receipt, M-Pesa code, cheque no.)' },
        { name: 'paid_on', label: 'Paid on', type: 'date', value: todayIso(), required: true },
      ],
      onSubmit: async (data) => {
        const p = await api('/payments', { method: 'POST', body: { ...data, tenant_id: Number(data.tenant_id) } });
        toast(`Payment recorded. Tenant balance: ${money(p.tenant_balance)}`);
        render();
      },
    });
  };
};

views.maintenance = async () => {
  const [rows, unitRows, leaseRows] = await Promise.all([
    api(`/maintenance?${qs({ org_id: state.org.id })}`),
    api(`/units?${qs({ org_id: state.org.id })}`),
    api(`/leases?${qs({ org_id: state.org.id, status: 'active' })}`),
  ]);
  const unitName = Object.fromEntries(unitRows.map((u) => [u.id, `${u.property_name} · ${u.label}`]));
  view.innerHTML = `
    <h1>Maintenance</h1>
    <p class="sub">Track repairs. Mark a job "recharge to tenant" and its cost is billed on their next invoice when completed.</p>
    <div class="toolbar"><button class="btn primary" id="add-request">New request</button></div>
    ${table([
      { label: 'Opened', value: (r) => r.created_at.slice(0, 10) },
      { label: 'Title', key: 'title' },
      { label: 'Unit', value: (r) => unitName[r.unit_id] ?? '' },
      { label: 'Priority', html: (r) => badge(r.priority) },
      { label: 'Cost', num: true, value: (r) => (r.cost ? money(r.cost) : '') },
      { label: 'Recharge', value: (r) => (r.recharge_to_tenant ? 'Yes' : '') },
      { label: 'Status', html: (r) => badge(r.status) },
    ], rows, { onRow: editRequest })}`;

  const leaseOptions = leaseRows.map((l) => [l.id, `${l.tenant_name} · ${l.property_name} ${l.unit_label}`]);
  document.getElementById('add-request').onclick = () => openForm({
    title: 'New maintenance request',
    fields: [
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'unit_id', label: 'Unit', type: 'select', options: unitRows.map((u) => [u.id, unitName[u.id]]) },
      { name: 'lease_id', label: 'Tenant lease (for recharges)', type: 'select', options: leaseOptions },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'], value: 'normal', required: true },
      { name: 'cost', label: 'Estimated cost', type: 'money' },
      { name: 'recharge_to_tenant', label: 'Recharge cost to tenant', type: 'checkbox' },
      { name: 'description', label: 'Details', type: 'textarea', full: true },
    ],
    onSubmit: async (data) => {
      const lease = leaseRows.find((l) => l.id === Number(data.lease_id));
      await api('/maintenance', {
        method: 'POST',
        body: { ...data, org_id: state.org.id, unit_id: data.unit_id ? Number(data.unit_id) : lease?.unit_id, lease_id: lease?.id, tenant_id: lease?.tenant_id },
      });
      toast('Request created');
      render();
    },
  });

  function editRequest(r) {
    openForm({
      title: r.title,
      fields: [
        { name: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'completed', 'cancelled'], value: r.status, required: true },
        { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'], value: r.priority, required: true },
        { name: 'cost', label: 'Cost', type: 'money', value: r.cost ? r.cost / 100 : '' },
        { name: 'lease_id', label: 'Tenant lease (for recharges)', type: 'select', options: leaseOptions, value: r.lease_id },
        { name: 'recharge_to_tenant', label: 'Recharge cost to tenant', type: 'checkbox', value: r.recharge_to_tenant },
      ],
      onSubmit: async (data) => {
        await api(`/maintenance/${r.id}`, { method: 'PATCH', body: { ...data, lease_id: data.lease_id ? Number(data.lease_id) : undefined } });
        toast(data.status === 'completed' && data.recharge_to_tenant ? 'Completed; cost added to the tenant’s next invoice' : 'Request updated');
        render();
      },
    });
  }
};

views.settings = async () => {
  const o = state.org;
  const planOptions = Object.entries(state.pricing.plans).map(([k, p]) => [k, `${p.name} (${money(p.monthlyPrice, state.pricing.currency)}/mo)`]);
  view.innerHTML = `
    <h1>Settings</h1>
    <p class="sub">Currency, tax, late fees and your AssetNest plan.</p>
    <div class="panel" style="padding:16px">
      <form class="grid" id="settings-form">
        <label>Organization name<input name="name" value="${esc(o.name)}" required></label>
        <label>Email<input name="email" type="email" value="${esc(o.email)}"></label>
        <label>Phone<input name="phone" value="${esc(o.phone)}"></label>
        <label>Currency (ISO code)<input name="currency" value="${esc(o.currency)}" maxlength="3" required></label>
        <label>VAT rate %<input name="vat_rate" type="number" step="any" value="${o.vat_rate}"></label>
        <label>Late fee type
          <select name="late_fee_type">${['none', 'flat', 'percent'].map((t) => `<option ${t === o.late_fee_type ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <label>Late fee (amount, or % of overdue balance)<input name="late_fee_value" type="number" step="any" value="${o.late_fee_type === 'flat' ? o.late_fee_value / 100 : o.late_fee_value}"></label>
        <label>Grace days after due date<input name="late_fee_grace_days" type="number" step="1" value="${o.late_fee_grace_days}"></label>
        <label>Plan<select name="plan">${planOptions.map(([k, t]) => `<option value="${k}" ${k === o.plan ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Billing cycle<select name="billing_cycle">${['monthly', 'annual'].map((c) => `<option ${c === o.billing_cycle ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <div class="form-actions full"><button class="btn primary">Save settings</button></div>
      </form>
    </div>
    <h2>Another landlord or company?</h2>
    <button class="btn" id="new-org">Create organization</button>`;

  document.getElementById('settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const lateType = f.late_fee_type.value;
    const body = {
      name: f.name.value,
      email: f.email.value || null,
      phone: f.phone.value || null,
      currency: f.currency.value.toUpperCase(),
      vat_rate: Number(f.vat_rate.value || 0),
      late_fee_type: lateType,
      late_fee_value: lateType === 'flat' ? toMinor(f.late_fee_value.value || 0) : Number(f.late_fee_value.value || 0),
      late_fee_grace_days: Number(f.late_fee_grace_days.value || 0),
      plan: f.plan.value,
      billing_cycle: f.billing_cycle.value,
    };
    try {
      state.org = await api(`/organizations/${o.id}`, { method: 'PATCH', body });
      await loadOrgs(state.org.id);
      toast('Settings saved');
    } catch (err) {
      toast(err.message, true);
    }
  };
  document.getElementById('new-org').onclick = createOrgForm;
};

function createOrgForm() {
  openForm({
    title: 'Create organization',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'currency', label: 'Currency (ISO code)', value: 'USD', required: true },
      { name: 'vat_rate', label: 'VAT rate %', type: 'percent', value: 0 },
      { name: 'plan', label: 'Plan', type: 'select', options: Object.entries(state.pricing.plans).map(([k, p]) => [k, p.name]), value: 'starter', required: true },
    ],
    onSubmit: async (data) => {
      const org = await api('/organizations', { method: 'POST', body: { ...data, currency: data.currency.toUpperCase() } });
      await loadOrgs(org.id);
      location.hash = 'properties';
      toast('Organization created');
    },
  });
}

views.pricing = async () => {
  const p = state.pricing;
  const cur = p.currency;
  const plans = Object.entries(p.plans);
  view.innerHTML = `
    <h1>AssetNest pricing</h1>
    <p class="sub">Pay for the units you manage. Annual billing: pay for ${p.annual_months_charged} months, get 12. Prices in ${esc(cur)}.</p>
    <div class="plans">
      ${plans.map(([code, plan]) => `
        <div class="card plan ${state.org?.plan === code ? 'current' : ''}">
          <div class="label">${esc(plan.name)}${state.org?.plan === code ? ' · current plan' : ''}</div>
          <div class="price">${plan.monthlyPrice ? money(plan.monthlyPrice, cur) : 'Free'}<span class="muted" style="font-size:0.9rem">${plan.monthlyPrice ? ' /month' : ''}</span></div>
          <div class="muted">${esc(plan.tagline)}</div>
          <ul>
            <li>${plan.includedUnits} units included${plan.extraUnitPrice != null ? `, then ${money(plan.extraUnitPrice, cur)}/unit` : ''}${plan.maxUnits ? ` (max ${plan.maxUnits})` : ''}</li>
            <li>${plan.includedUsers ?? 'Unlimited'} team member${plan.includedUsers === 1 ? '' : 's'}</li>
            <li>${plan.includedSms} SMS reminders / month</li>
            <li>Card payments: ${plan.onlinePaymentFeePercent}% + ${money(p.transaction_fees.card.fixed, cur)}</li>
            ${plan.features.map((f) => `<li>${esc(f)}</li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>

    <div class="two-col">
      <div>
        <h2>Add-ons</h2>
        ${table([
          { label: 'Add-on', key: 'name' },
          { label: 'Price', num: true, value: (a) => `${money(a.price, cur)} / ${a.unit}` },
          { label: 'Included in', value: (a) => (a.includedIn ?? []).map((c) => p.plans[c].name).join(', ') },
        ], Object.values(p.addons))}
        <h2>One-off services</h2>
        ${table([
          { label: 'Service', key: 'name' },
          { label: 'Price', num: true, value: (a) => money(a.price, cur) },
          { label: 'Included in', value: (a) => (a.includedIn ?? []).map((c) => p.plans[c].name).join(', ') },
        ], Object.values(p.one_time_fees))}
        <h2>Rent collection fees</h2>
        <p class="muted">Charged to the landlord on rent paid through AssetNest. Payments you record yourself are free.</p>
        ${table([
          { label: 'Method', key: 'name' },
          { label: 'Fee', num: true, value: (f) => (f.usesPlanPercent ? `plan rate + ${money(f.fixed, cur)}` : [f.percent ? `${f.percent}%` : '', f.fixed ? money(f.fixed, cur) : ''].filter(Boolean).join(' + ') || 'Free') },
        ], Object.values(p.transaction_fees))}
      </div>
      <div>
        <h2>Price calculator</h2>
        <div class="panel" style="padding:16px">
          <form class="grid" id="quote-form">
            <label>Units you manage<input name="units" type="number" min="0" value="20"></label>
            <label>Plan<select name="plan"><option value="">Recommend for me</option>${plans.map(([k, pl]) => `<option value="${k}">${esc(pl.name)}</option>`).join('')}</select></label>
            <label>Billing<select name="cycle"><option>monthly</option><option>annual</option></select></label>
            <label>Team members<input name="users" type="number" min="1" value="1"></label>
            <label>SMS / month<input name="smsPerMonth" type="number" min="0" value="0"></label>
            <label>E-signed leases / month<input name="eSignatures" type="number" min="0" value="0"></label>
            <label>Screenings / month<input name="screenings" type="number" min="0" value="0"></label>
            <label>Extra storage (10 GB blocks)<input name="storageBlocks" type="number" min="0" value="0"></label>
            <label><span><input type="checkbox" name="premiumSupport"> Premium support</span></label>
            <label><span><input type="checkbox" name="whiteLabel"> White-label portal</span></label>
            <label><span><input type="checkbox" name="dataMigration"> Data migration</span></label>
            <label><span><input type="checkbox" name="onboardingTraining"> Onboarding training</span></label>
          </form>
          <div id="quote-result" style="margin-top:12px"></div>
        </div>
      </div>
    </div>`;

  const form = document.getElementById('quote-form');
  const update = async () => {
    const f = form.elements;
    const body = { units: Number(f.units.value || 0), cycle: f.cycle.value };
    if (f.plan.value) body.plan = f.plan.value;
    for (const n of ['users', 'smsPerMonth', 'eSignatures', 'screenings', 'storageBlocks']) body[n] = Number(f[n].value || 0);
    for (const n of ['premiumSupport', 'whiteLabel', 'dataMigration', 'onboardingTraining']) body[n] = f[n].checked;
    try {
      const q = await api('/pricing/quote', { method: 'POST', body });
      document.getElementById('quote-result').innerHTML = `
        <p><strong>${esc(p.plans[q.plan].name)} plan</strong></p>
        ${q.lines.map((l) => `<div>${esc(l.description)}${l.quantity > 1 ? ` × ${l.quantity}` : ''}<span style="float:right">${money(l.amount, cur)}</span></div>`).join('')}
        <hr>
        <div>Per month<strong style="float:right">${money(q.monthlyTotal, cur)}</strong></div>
        ${q.cycle === 'annual' ? `<div>Per year (2 months free)<strong style="float:right">${money(q.recurringTotal, cur)}</strong></div><div class="muted">You save ${money(q.annualSavings, cur)} a year</div>` : ''}
        ${q.oneTime.length ? `<div>One-off<strong style="float:right">${money(q.oneTimeTotal, cur)}</strong></div>` : ''}
        <div>Due today<strong style="float:right">${money(q.dueToday, cur)}</strong></div>
        ${q.warnings.map((w) => `<p class="warning">${esc(w)}</p>`).join('')}`;
    } catch (err) {
      document.getElementById('quote-result').innerHTML = `<p class="warning">${esc(err.message)}</p>`;
    }
  };
  form.addEventListener('input', update);
  update();
};

// ---------------------------------------------------------------- shell

async function loadOrgs(selectId) {
  state.orgs = await api('/organizations');
  const select = document.getElementById('org-select');
  select.innerHTML = state.orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const id = Number(selectId ?? localStorageGet('assetnest.org') ?? state.orgs[0]?.id);
  state.org = state.orgs.find((o) => o.id === id) ?? state.orgs[0] ?? null;
  if (state.org) {
    select.value = state.org.id;
    localStorageSet('assetnest.org', state.org.id);
  }
}

function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

async function render() {
  const name = (location.hash.slice(1).split('?')[0] || 'dashboard');
  if (dialog.open) dialog.close();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (!state.org && name !== 'pricing') {
    view.innerHTML = `
      <h1>Welcome to AssetNest</h1>
      <p class="sub">Rental management for every kind of property: apartments, office blocks, malls and more.</p>
      <button class="btn primary" id="first-org">Create your organization</button>
      <p class="muted">Or load demo data from the command line: <code>npm run seed</code></p>`;
    document.getElementById('first-org').onclick = createOrgForm;
    return;
  }
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await (views[name] ?? views.dashboard)();
  } catch (err) {
    view.innerHTML = `<p class="warning">${esc(err.message)}</p>`;
  }
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) location.hash = b.dataset.view;
});
document.getElementById('org-select').addEventListener('change', async (e) => {
  await loadOrgs(Number(e.target.value));
  render();
});
window.addEventListener('hashchange', render);

(async () => {
  [state.ref, state.pricing] = await Promise.all([api('/charge-types'), api('/pricing')]);
  await loadOrgs();
  render();
})();
