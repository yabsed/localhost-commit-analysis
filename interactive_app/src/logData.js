const AUTHOR_RE = /^(.*?)\s*<([^>]+)>$/;
const PREFERRED_PROJECT_ORDER = ['mobile', 'pc', 'server'];

const AUTHOR_COLORS = [
  '#005f73',
  '#0a9396',
  '#94d2bd',
  '#ee9b00',
  '#ca6702',
  '#bb3e03',
  '#ae2012',
  '#3a86ff',
  '#2a9d8f',
  '#264653',
];

function basename(path = '') {
  const normalized = String(path).replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function stripExt(name = '') {
  return name.replace(/\.[^.]+$/, '');
}

function projectLabel(projectId) {
  const map = {
    mobile: 'Mobile',
    pc: 'PC',
    server: 'Server',
  };
  return map[projectId] ?? projectId;
}

function parseAuthor(rawAuthor = '') {
  const source = String(rawAuthor || '').trim();
  const matched = AUTHOR_RE.exec(source);
  if (matched) {
    const name = matched[1].trim() || matched[2].trim().split('@')[0];
    const email = matched[2].trim().toLowerCase();
    return {
      id: email,
      name,
      email,
      raw: source,
    };
  }

  const fallback = source || 'unknown';
  return {
    id: fallback.toLowerCase(),
    name: fallback,
    email: null,
    raw: source,
  };
}

function parseTimestampMs(entry) {
  const candidates = [entry.timestamp_utc, entry.date_original];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  return 0;
}

function computeLineStats(rawText = '') {
  const lines = String(rawText).split('\n');
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
      continue;
    }
    if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return {
    additions,
    deletions,
    touched: additions + deletions,
  };
}

function extractCommitTitle(rawText = '') {
  const lines = String(rawText).split('\n');
  let seenHeaderBreak = false;

  for (const line of lines) {
    if (!seenHeaderBreak) {
      if (line.trim() === '') {
        seenHeaderBreak = true;
      }
      continue;
    }

    if (line.startsWith('    ')) {
      return line.trim();
    }

    if (line.startsWith('diff --git')) {
      break;
    }
  }

  return '(메시지 없음)';
}

function pickDisplayName(nameCountMap) {
  let bestName = 'Unknown';
  let bestCount = -1;
  for (const [name, count] of nameCountMap.entries()) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  return bestName;
}

function toPath(fromNode, toNode) {
  if (fromNode.x === toNode.x) {
    return `M ${fromNode.x} ${fromNode.y} L ${toNode.x} ${toNode.y}`;
  }

  const deltaY = toNode.y - fromNode.y;
  const control1Y = fromNode.y + deltaY * 0.35;
  const control2Y = toNode.y - deltaY * 0.35;

  return [
    `M ${fromNode.x} ${fromNode.y}`,
    `C ${fromNode.x} ${control1Y}, ${toNode.x} ${control2Y}, ${toNode.x} ${toNode.y}`,
  ].join(' ');
}

export function formatKoreanDateTime(timestampMs) {
  return new Date(timestampMs).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

export function processLogData(payload) {
  const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
  const projectStatsMap = new Map();
  const authorNameCounts = new Map();
  const authorStatsMap = new Map();

  const normalizedNodes = rawEntries.map((entry, index) => {
    const projectId = stripExt(basename(entry.source_file));
    const author = parseAuthor(entry.author);
    const lineStats = computeLineStats(entry.raw_text);
    const timestampMs = parseTimestampMs(entry);

    if (!projectStatsMap.has(projectId)) {
      projectStatsMap.set(projectId, {
        id: projectId,
        label: projectLabel(projectId),
        commits: 0,
        lines: 0,
      });
    }

    if (!authorNameCounts.has(author.id)) {
      authorNameCounts.set(author.id, new Map());
    }
    if (!authorStatsMap.has(author.id)) {
      authorStatsMap.set(author.id, {
        id: author.id,
        email: author.email,
        commits: 0,
        lines: 0,
      });
    }

    const nameCounter = authorNameCounts.get(author.id);
    nameCounter.set(author.name, (nameCounter.get(author.name) ?? 0) + 1);

    const projectStats = projectStatsMap.get(projectId);
    projectStats.commits += 1;
    projectStats.lines += lineStats.touched;

    const authorStats = authorStatsMap.get(author.id);
    authorStats.commits += 1;
    authorStats.lines += lineStats.touched;

    return {
      id: `${projectId}-${entry.source_commit_index}-${entry.commit_hash || index}`,
      index,
      projectId,
      commitHash: entry.commit_hash || '',
      commitShortHash: String(entry.commit_hash || '').slice(0, 7),
      sourceCommitIndex: entry.source_commit_index,
      sourceOrder: entry.source_order ?? 0,
      authorId: author.id,
      authorRaw: author.raw,
      authorFallbackName: author.name,
      title: extractCommitTitle(entry.raw_text),
      timestampMs,
      timestampUtc: entry.timestamp_utc,
      dateOriginal: entry.date_original,
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      touchedLines: lineStats.touched,
      rawText: entry.raw_text,
    };
  });

  normalizedNodes.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) {
      return a.timestampMs - b.timestampMs;
    }
    if (a.sourceOrder !== b.sourceOrder) {
      return a.sourceOrder - b.sourceOrder;
    }
    return a.sourceCommitIndex - b.sourceCommitIndex;
  });

  const authors = [...authorStatsMap.values()]
    .map((author) => ({
      ...author,
      displayName: pickDisplayName(authorNameCounts.get(author.id) ?? new Map()),
    }))
    .sort((a, b) => {
      if (b.commits !== a.commits) {
        return b.commits - a.commits;
      }
      return b.lines - a.lines;
    })
    .map((author, index) => ({
      ...author,
      key: `author_${index}`,
      color: AUTHOR_COLORS[index % AUTHOR_COLORS.length],
    }));

  const authorById = new Map(authors.map((author) => [author.id, author]));

  for (const node of normalizedNodes) {
    const author = authorById.get(node.authorId);
    node.authorKey = author?.key;
    node.authorName = author?.displayName ?? node.authorFallbackName;
    node.authorColor = author?.color ?? '#7b8a8b';
  }

  const authorByKey = Object.fromEntries(authors.map((author) => [author.key, author]));

  const projectIds = [
    ...PREFERRED_PROJECT_ORDER.filter((projectId) => projectStatsMap.has(projectId)),
    ...[...projectStatsMap.keys()]
      .filter((projectId) => !PREFERRED_PROJECT_ORDER.includes(projectId))
      .sort(),
  ];

  const projects = projectIds.map((projectId) => projectStatsMap.get(projectId));

  const commitRows = projects.map((project) => {
    const row = {
      projectId: project.id,
      projectLabel: project.label,
      total: 0,
    };

    for (const author of authors) {
      row[author.key] = 0;
    }

    for (const node of normalizedNodes) {
      if (node.projectId !== project.id) {
        continue;
      }
      row[node.authorKey] += 1;
      row.total += 1;
    }

    return row;
  });

  const lineRows = projects.map((project) => {
    const row = {
      projectId: project.id,
      projectLabel: project.label,
      total: 0,
    };

    for (const author of authors) {
      row[author.key] = 0;
    }

    for (const node of normalizedNodes) {
      if (node.projectId !== project.id) {
        continue;
      }
      row[node.authorKey] += node.touchedLines;
      row.total += node.touchedLines;
    }

    return row;
  });

  const laneSpacing = 280;
  const laneStartX = 130;
  const rowSpacing = 56;
  const topPadding = 92;
  const bottomPadding = 96;

  const laneByProject = new Map(
    projects.map((project, laneIndex) => [
      project.id,
      {
        laneIndex,
        x: laneStartX + laneIndex * laneSpacing,
        ...project,
      },
    ])
  );

  const maxTouchedLines = Math.max(1, ...normalizedNodes.map((node) => node.touchedLines));

  const timelineNodes = normalizedNodes.map((node, timeIndex) => {
    const lane = laneByProject.get(node.projectId);
    const radius = 4 + (Math.sqrt(node.touchedLines || 0) / Math.sqrt(maxTouchedLines)) * 7;

    return {
      ...node,
      timelineIndex: timeIndex,
      x: lane?.x ?? laneStartX,
      y: topPadding + timeIndex * rowSpacing,
      radius,
      lane,
    };
  });

  const projectEdges = [];
  const precedenceEdges = [];
  const authorEdges = [];

  const previousByProject = new Map();
  const previousByAuthor = new Map();

  timelineNodes.forEach((node, index) => {
    const previousSameProject = previousByProject.get(node.projectId);
    if (previousSameProject) {
      projectEdges.push({
        from: previousSameProject,
        to: node,
        path: toPath(previousSameProject, node),
      });
    }
    previousByProject.set(node.projectId, node);

    const previousGlobal = timelineNodes[index - 1];
    if (previousGlobal && previousGlobal.projectId !== node.projectId) {
      precedenceEdges.push({
        from: previousGlobal,
        to: node,
        path: toPath(previousGlobal, node),
      });
    }

    const previousAuthor = previousByAuthor.get(node.authorId);
    if (previousAuthor && previousAuthor.projectId !== node.projectId) {
      authorEdges.push({
        from: previousAuthor,
        to: node,
        authorId: node.authorId,
        color: node.authorColor,
        path: toPath(previousAuthor, node),
      });
    }
    previousByAuthor.set(node.authorId, node);
  });

  const timeline = {
    width: laneStartX * 2 + (projects.length - 1) * laneSpacing,
    height: topPadding + timelineNodes.length * rowSpacing + bottomPadding,
    topPadding,
    lanes: projects.map((project) => laneByProject.get(project.id)),
    nodes: timelineNodes,
    projectEdges,
    precedenceEdges,
    authorEdges,
  };

  const totals = {
    commits: normalizedNodes.length,
    lines: normalizedNodes.reduce((sum, node) => sum + node.touchedLines, 0),
    authors: authors.length,
    crossProjectTransitions: authorEdges.length,
  };

  return {
    authors,
    authorByKey,
    projects,
    commitRows,
    lineRows,
    timeline,
    totals,
  };
}
