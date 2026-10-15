import type { ProjectDashboardData } from '../shared/types';
import './projects-view.css';

type DashboardProject = ProjectDashboardData['projects'][number];

const STATE_LABELS: Record<DashboardProject['state'], string> = {
  working: '工作中',
  asking: '等回答',
  approval: '等授权',
  paused: '已暂停',
  failed: '失败',
  quota_exhausted: '额度耗尽',
  completed: '已完成',
  idle: '待机',
};

const STATE_ORDER: Record<DashboardProject['state'], number> = {
  approval: 0,
  asking: 1,
  working: 2,
  failed: 3,
  quota_exhausted: 4,
  paused: 5,
  completed: 6,
  idle: 7,
};

const MONITOR_LABELS: Record<ProjectDashboardData['monitor']['state'], string> = {
  starting: '正在读取',
  watching: '正在观察',
  unavailable: '暂不可用',
  disabled: '已关闭',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

function formatTime(value: string | null | undefined, includeDate = false): string {
  if (!value) return '尚无记录';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '尚无记录';
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeDate ? { month: '2-digit', day: '2-digit' } as const : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function metric(label: string) {
  const card = element('div', 'projects-metric');
  const number = element('strong', 'projects-metric-number', '—');
  card.append(number, element('span', 'projects-metric-label', label));
  return { card, number };
}

function projectCard(project: DashboardProject): HTMLElement {
  const card = element('article', 'projects-card');
  card.dataset.projectKey = project.key;
  card.dataset.state = project.state;
  const heading = element('div', 'projects-card-heading');
  const title = element('h3', 'projects-card-title', project.name || '未命名项目');
  const badge = element('span', 'projects-state', STATE_LABELS[project.state]);
  badge.dataset.state = project.state;
  heading.append(title, badge);
  card.append(heading);
  if (project.path) {
    const path = element('p', 'projects-path', project.path);
    path.title = project.path;
    card.append(path);
  }
  const sessions = element('p', 'projects-sessions');
  const sessionCount = Math.max(0, project.sessionCount);
  const workingCount = Math.max(0, project.workingSessionCount);
  sessions.textContent = `${sessionCount} 个会话${workingCount ? ` · ${workingCount} 个正在工作` : ''}`;
  card.append(sessions);
  const footer = element('div', 'projects-card-footer');
  footer.append(element('span', 'projects-last-event', project.lastEventLabel || '暂无状态事件'));
  const time = element('time', 'projects-time', formatTime(project.lastEventAt, true));
  if (project.lastEventAt) time.dateTime = project.lastEventAt;
  footer.append(time);
  card.append(footer);
  return card;
}

/** A separate tray window; project monitoring stays in the main process. */
export async function setupProjectsView(): Promise<void> {
  document.body.dataset.view = 'projects';
  document.querySelector('#pet-view')?.setAttribute('hidden', '');
  document.querySelector('#settings-view')?.setAttribute('hidden', '');
  document.title = '当前项目 · Deskfolk';

  const main = element('main', 'projects-page');
  const header = element('header', 'projects-header');
  const heading = element('div', 'projects-heading');
  heading.append(
    element('p', 'projects-eyebrow', 'DESKFOLK'),
    element('h1', 'projects-title', '当前项目'),
    element('p', 'projects-intro', '看看小睦正在陪你做些什么。'),
  );
  const actions = element('div', 'projects-header-actions');
  const refresh = element('button', 'projects-button', '刷新');
  refresh.type = 'button';
  const openCodex = element('button', 'projects-button projects-button-primary', '打开 Codex');
  openCodex.type = 'button';
  actions.append(refresh, openCodex);
  header.append(heading, actions);

  const status = element('p', 'projects-operation-status', '正在读取项目状态……');
  status.setAttribute('role', 'status');
  const overview = element('section', 'projects-overview');
  overview.setAttribute('aria-label', '项目概况');
  const working = metric('正在工作的项目');
  const pending = metric('待处理提醒');
  const total = metric('已发现的项目');
  overview.append(working.card, pending.card, total.card);

  const projectsSection = element('section', 'projects-section');
  const projectHeading = element('div', 'projects-section-heading');
  projectHeading.append(
    element('h2', 'projects-section-title', '项目状态'),
    element('span', 'projects-section-note', '同一项目的会话合并显示'),
  );
  const projectList = element('div', 'projects-list');
  projectList.setAttribute('aria-label', '当前项目列表');
  projectsSection.append(projectHeading, projectList);

  const monitoring = element('section', 'projects-monitor');
  const monitorHeading = element('div', 'projects-section-heading');
  const monitorState = element('span', 'projects-monitor-state', '正在读取');
  monitorState.dataset.state = 'starting';
  monitorHeading.append(element('h2', 'projects-section-title', '监控情况'), monitorState);
  const monitorDetails = element('dl', 'projects-monitor-details');
  const monitorRows = new Map<string, HTMLElement>();
  for (const label of ['本地通知', '最后检查', '最近有效事件', '已发现会话', '等待扫描']) {
    const row = element('div', 'projects-monitor-row');
    const value = element('dd', 'projects-monitor-value', '—');
    row.append(element('dt', 'projects-monitor-label', label), value);
    monitorDetails.append(row);
    monitorRows.set(label, value);
  }
  const approvalNote = element('p', 'projects-monitor-note');
  monitoring.append(monitorHeading, monitorDetails, approvalNote);

  const eventsSection = element('section', 'projects-section');
  eventsSection.append(element('h2', 'projects-section-title', '最近有效事件'));
  const eventList = element('ol', 'projects-events');
  eventsSection.append(eventList);

  const footer = element('footer', 'projects-footer');
  const snapshot = element('span', 'projects-snapshot', '尚未收到项目状态');
  const settings = element('button', 'projects-link-button', '通知设置');
  settings.type = 'button';
  settings.addEventListener('click', () => window.petBridge.openSettings());
  footer.append(snapshot, settings);
  main.append(header, status, overview, projectsSection, monitoring, eventsSection, footer);
  document.body.append(main);

  let lastSnapshotTime = -Infinity;
  let projectSignature: string | undefined;
  let eventSignature: string | undefined;
  let hasSnapshot = false;
  let disposed = false;

  const render = (data: ProjectDashboardData) => {
    if (disposed) return;
    const incomingTime = Date.parse(data.capturedAt);
    if (Number.isFinite(incomingTime) && incomingTime < lastSnapshotTime) return;
    if (Number.isFinite(incomingTime)) lastSnapshotTime = incomingTime;
    const firstSnapshot = !hasSnapshot;
    hasSnapshot = true;
    main.setAttribute('aria-busy', 'false');
    if (firstSnapshot) setText(status, '');
    setText(working.number, String(data.workingProjectCount));
    setText(pending.number, String(data.pendingRequestCount));
    setText(total.number, String(data.projects.length));
    pending.card.dataset.active = String(data.pendingRequestCount > 0);
    working.card.dataset.active = String(data.workingProjectCount > 0);

    const nextProjectSignature = JSON.stringify(data.projects);
    if (nextProjectSignature !== projectSignature) {
      projectSignature = nextProjectSignature;
      const fragment = document.createDocumentFragment();
      const ordered = [...data.projects].sort((a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name, 'zh-CN'),
      );
      for (const project of ordered) fragment.append(projectCard(project));
      if (!ordered.length) {
        const empty = element('div', 'projects-empty');
        empty.append(
          element('strong', '', '还没有可显示的项目'),
          element('p', '', '打开 Codex 或继续一个任务后，这里会更新。'),
        );
        fragment.append(empty);
      }
      projectList.replaceChildren(fragment);
    }

    setText(monitorState, MONITOR_LABELS[data.monitor.state]);
    monitorState.dataset.state = data.monitor.state;
    setText(monitorRows.get('本地通知')!, data.bridgeReady ? '已连接' : '未连接');
    setText(monitorRows.get('最后检查')!, formatTime(data.monitor.lastPollAt, true));
    setText(monitorRows.get('最近有效事件')!, formatTime(data.monitor.lastEventAt, true));
    setText(monitorRows.get('已发现会话')!, String(data.monitor.observedSessions));
    setText(monitorRows.get('等待扫描')!, String(data.monitor.discoveryPending));
    setText(approvalNote, '这里提醒 Codex 中实际待回答的问题；工具权限请在 Codex 原生面板中确认。');

    const nextEventSignature = JSON.stringify(data.recentEvents);
    if (nextEventSignature !== eventSignature) {
      eventSignature = nextEventSignature;
      const fragment = document.createDocumentFragment();
      for (const event of data.recentEvents) {
        const row = element('li', 'projects-event');
        const content = element('div', 'projects-event-content');
        content.append(element('span', 'projects-event-label', event.label));
        if (event.project) content.append(element('span', 'projects-event-project', event.project));
        const time = element('time', 'projects-time', formatTime(event.createdAt, true));
        time.dateTime = event.createdAt;
        row.append(content, time);
        fragment.append(row);
      }
      if (!data.recentEvents.length) fragment.append(element('li', 'projects-event-empty', '还没有有效事件。'));
      eventList.replaceChildren(fragment);
    }
    setText(snapshot, `更新于 ${formatTime(data.capturedAt)}`);
  };

  const load = async () => {
    if (disposed || refresh.disabled) return;
    refresh.disabled = true;
    refresh.textContent = '读取中…';
    if (hasSnapshot) setText(status, '');
    if (!hasSnapshot) main.setAttribute('aria-busy', 'true');
    try {
      render(await window.petBridge.getProjects());
    } catch {
      if (!disposed) setText(status, '项目状态暂时无法读取。可以稍后刷新。');
    } finally {
      if (!disposed) {
        main.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
        refresh.textContent = '刷新';
      }
    }
  };

  refresh.addEventListener('click', () => { void load(); });
  openCodex.addEventListener('click', async () => {
    openCodex.disabled = true;
    setText(status, '正在打开 Codex……');
    try {
      const result = await window.petBridge.openCodex();
      if (!disposed) setText(status, result.ok ? '' : '没有找到 Codex 窗口，请先启动 Codex。');
    } catch {
      if (!disposed) setText(status, '暂时无法打开 Codex。请在任务栏中打开。');
    } finally {
      if (!disposed) openCodex.disabled = false;
    }
  });

  // Subscribe before requesting the snapshot so no state change is lost during startup.
  const unsubscribe = window.petBridge.onProjects(render);
  window.addEventListener('pagehide', () => {
    disposed = true;
    unsubscribe();
  }, { once: true });
  await load();
}
