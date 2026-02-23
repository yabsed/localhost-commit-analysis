import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
} from '@tabler/icons-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import {
  formatKoreanDateTime,
  formatNumber,
  processLogData,
} from './logData';

const DEFAULT_IDENTITY_RULES_TEXT = 'Seo Minseok - user983740';
const PROJECT_LINE_FALLBACK_STROKES = ['#111111', '#4b4b4b', '#777777', '#9a9a9a'];
const PROJECT_LINE_DASHES = ['', '6 4', '3 4', '10 4'];

function splitIdentityRuleLine(line) {
  const source = String(line || '').trim();
  if (!source || source.startsWith('#')) {
    return null;
  }

  const splitBy = (delimiter) => {
    const index = source.indexOf(delimiter);
    if (index < 0) {
      return null;
    }
    const left = source.slice(0, index).trim();
    const right = source.slice(index + delimiter.length).trim();
    if (!left || !right) {
      return null;
    }
    return [left, right];
  };

  return (
    splitBy('->') ??
    splitBy(' - ') ??
    splitBy(',') ??
    splitBy('\t') ??
    (() => {
      const firstDash = source.indexOf('-');
      const lastDash = source.lastIndexOf('-');
      if (firstDash <= 1 || firstDash !== lastDash || firstDash >= source.length - 2) {
        return null;
      }
      const left = source.slice(0, firstDash).trim();
      const right = source.slice(firstDash + 1).trim();
      if (left.length < 2 || right.length < 2) {
        return null;
      }
      return [left, right];
    })()
  );
}

function parseIdentityRules(rawText = '') {
  const lines = String(rawText || '').split('\n');
  const pairs = [];
  const invalidLines = [];

  lines.forEach((line, index) => {
    const source = String(line || '').trim();
    if (!source || source.startsWith('#')) {
      return;
    }

    const pair = splitIdentityRuleLine(source);
    if (!pair) {
      invalidLines.push({ lineNumber: index + 1, value: source });
      return;
    }
    pairs.push(pair);
  });

  return {
    pairs,
    invalidLines,
  };
}

function StackedTooltip({ active, payload, label, authorByKey, unitLabel }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const normalized = payload
    .filter((item) => Number(item.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));

  return (
    <Paper shadow="md" radius="md" p="sm" withBorder className="chart-tooltip">
      <Text fw={700} mb={6}>{label}</Text>
      <Stack gap={4}>
        {normalized.map((item) => {
          const author = authorByKey[item.dataKey];
          return (
            <Group key={`${item.dataKey}-${label}`} justify="space-between" gap="xl">
              <Group gap={8}>
                <span
                  className="swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <Text size="sm">{author?.displayName ?? item.dataKey}</Text>
              </Group>
              <Text size="sm" fw={700}>{formatNumber(item.value)} {unitLabel}</Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

function buildEdgeClass(type) {
  if (type === 'project') {
    return 'timeline-edge timeline-edge-project';
  }
  if (type === 'precedence') {
    return 'timeline-edge timeline-edge-precedence';
  }
  return 'timeline-edge timeline-edge-author';
}

function selectedCommitText(node) {
  if (!node) {
    return '커밋을 클릭하면 상세 정보가 표시됩니다.';
  }

  return [
    `[${node.lane?.label}]`,
    node.title,
    `${node.commitShortHash} · ${formatKoreanDateTime(node.timestampMs)}`,
  ].join(' ');
}

function buildCumulativeRows(
  projects,
  authors,
  nodes,
  subtractDeletions = false,
  excludedCommitIds = null
) {
  const commitRowsByProject = new Map();
  const lineRowsByProject = new Map();

  for (const project of projects) {
    const commitRow = {
      projectId: project.id,
      projectLabel: project.label,
      total: 0,
    };
    const lineRow = {
      projectId: project.id,
      projectLabel: project.label,
      total: 0,
    };

    for (const author of authors) {
      commitRow[author.key] = 0;
      lineRow[author.key] = 0;
    }

    commitRowsByProject.set(project.id, commitRow);
    lineRowsByProject.set(project.id, lineRow);
  }

  for (const node of nodes) {
    if (excludedCommitIds?.has(node.id)) {
      continue;
    }

    const commitRow = commitRowsByProject.get(node.projectId);
    const lineRow = lineRowsByProject.get(node.projectId);

    if (!commitRow || !lineRow || !node.authorKey) {
      continue;
    }

    commitRow[node.authorKey] += 1;
    commitRow.total += 1;

    const touchedLines = Number(node.touchedLines) || 0;
    const netLines = (Number(node.additions) || 0) - (Number(node.deletions) || 0);
    const lineValue = subtractDeletions ? netLines : touchedLines;
    lineRow[node.authorKey] += lineValue;
    lineRow.total += lineValue;
  }

  return {
    commitRows: projects.map((project) => commitRowsByProject.get(project.id)),
    lineRows: projects.map((project) => lineRowsByProject.get(project.id)),
  };
}

function trendDelta(node, metric, subtractDeletions = false) {
  if (metric === 'commits') {
    return 1;
  }
  return subtractDeletions
    ? (Number(node.additions) || 0) - (Number(node.deletions) || 0)
    : Number(node.touchedLines) || 0;
}

function commitLength(node) {
  const touched = Number(node.touchedLines);
  if (Number.isFinite(touched) && touched >= 0) {
    return touched;
  }
  return (Number(node.additions) || 0) + (Number(node.deletions) || 0);
}

function buildTopLongestCommitIdSet(nodes, topPercent = 0.05) {
  if (!Array.isArray(nodes) || nodes.length === 0 || topPercent <= 0) {
    return new Set();
  }

  const byProject = new Map();
  for (const node of nodes) {
    const projectId = node.projectId ?? '__unknown_project__';
    if (!byProject.has(projectId)) {
      byProject.set(projectId, []);
    }
    byProject.get(projectId).push(node);
  }

  const excludedIds = new Set();
  for (const projectNodes of byProject.values()) {
    const removeCount = Math.ceil(projectNodes.length * topPercent);
    if (removeCount <= 0) {
      continue;
    }

    const ranked = projectNodes
      .map((node) => ({
        id: node.id,
        length: commitLength(node),
        timestampMs: Number(node.timestampMs) || 0,
      }))
      .sort((a, b) => (
        b.length - a.length
        || b.timestampMs - a.timestampMs
        || String(a.id).localeCompare(String(b.id))
      ));

    for (const item of ranked.slice(0, removeCount)) {
      excludedIds.add(item.id);
    }
  }

  return excludedIds;
}

function buildProjectTrendRows(
  nodes,
  projects,
  metric,
  subtractDeletions = false,
  excludedCommitIds = null
) {
  const totalsByProjectId = Object.fromEntries(projects.map((line) => [line.id, 0]));
  const rows = nodes.map((node, index) => {
    const delta = excludedCommitIds?.has(node.id)
      ? 0
      : trendDelta(node, metric, subtractDeletions);
    totalsByProjectId[node.projectId] = (Number(totalsByProjectId[node.projectId]) || 0) + delta;

    const row = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
    };

    for (const projectLine of projects) {
      row[projectLine.key] = Number(totalsByProjectId[projectLine.id]) || 0;
    }

    return row;
  });

  return rows;
}

function buildProjectTrendSeries(projects, commitRows, authors) {
  const authorByKey = new Map(authors.map((author) => [author.key, author]));

  return projects.map((project, index) => {
    const row = commitRows.find((item) => item.projectId === project.id);
    let topAuthorKey = null;
    let topCommitCount = -1;

    for (const author of authors) {
      const commitCount = Number(row?.[author.key]) || 0;
      if (commitCount > topCommitCount) {
        topCommitCount = commitCount;
        topAuthorKey = author.key;
      }
    }

    const topAuthor = topAuthorKey ? authorByKey.get(topAuthorKey) : null;
    return {
      id: project.id,
      label: project.label,
      key: `project_line_${index}`,
      stroke: topAuthor?.color ?? PROJECT_LINE_FALLBACK_STROKES[index % PROJECT_LINE_FALLBACK_STROKES.length],
      dash: PROJECT_LINE_DASHES[index % PROJECT_LINE_DASHES.length],
    };
  });
}

function buildAuthorTrendSeries(authors) {
  return authors.map((author) => ({
    id: author.id,
    label: author.displayName,
    key: author.key,
    stroke: author.color,
    dash: '',
  }));
}

function buildAuthorTrendRows(
  nodes,
  authorSeries,
  metric,
  subtractDeletions = false,
  excludedCommitIds = null
) {
  const totalsByAuthorKey = Object.fromEntries(authorSeries.map((line) => [line.key, 0]));
  return nodes.map((node, index) => {
    const delta = excludedCommitIds?.has(node.id)
      ? 0
      : trendDelta(node, metric, subtractDeletions);
    if (node.authorKey && Object.prototype.hasOwnProperty.call(totalsByAuthorKey, node.authorKey)) {
      totalsByAuthorKey[node.authorKey] += delta;
    }

    const row = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
    };

    for (const authorLine of authorSeries) {
      row[authorLine.key] = Number(totalsByAuthorKey[authorLine.key]) || 0;
    }

    return row;
  });
}

function findNearestNodeIndex(nodes, targetY) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < nodes.length; index += 1) {
    const distance = Math.abs((nodes[index]?.y ?? 0) - targetY);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

export default function App() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const [focusLineY, setFocusLineY] = useState(0);
  const [subtractDeletions, setSubtractDeletions] = useState(false);
  const [excludeTopLongCommits, setExcludeTopLongCommits] = useState(false);
  const [barChartMode, setBarChartMode] = useState('commits');
  const [trendScope, setTrendScope] = useState('byProject');
  const [identityRulesText, setIdentityRulesText] = useState(DEFAULT_IDENTITY_RULES_TEXT);
  const [draftIdentityRulesText, setDraftIdentityRulesText] = useState(DEFAULT_IDENTITY_RULES_TEXT);
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  const timelineScrollRef = useRef(null);
  const trendMetric = barChartMode === 'commits' ? 'commits' : 'code';

  const identityRules = useMemo(
    () => parseIdentityRules(identityRulesText),
    [identityRulesText]
  );

  const draftIdentityRules = useMemo(
    () => parseIdentityRules(draftIdentityRulesText),
    [draftIdentityRulesText]
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch('/merged_git_logs.json');
        if (!res.ok) {
          throw new Error(`데이터 로드 실패: ${res.status}`);
        }
        const data = await res.json();
        if (mounted) {
          setPayload(data);
          setError('');
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const prepared = useMemo(() => {
    if (!payload) {
      return null;
    }
    return processLogData(payload, {
      identityPairs: identityRules.pairs,
    });
  }, [payload, identityRules]);

  const selectedNode = useMemo(() => {
    if (!prepared?.timeline?.nodes?.length) {
      return null;
    }

    const fallbackIndex = Math.max(
      0,
      Math.min(prepared.timeline.nodes.length - 1, visibleNodeCount - 1)
    );

    return (
      prepared.timeline.nodes.find((node) => node.id === selectedId) ??
      prepared.timeline.nodes[fallbackIndex]
    );
  }, [prepared, selectedId, visibleNodeCount]);
  const commitRows = prepared?.commitRows ?? [];
  const projects = prepared?.projects ?? [];
  const authors = prepared?.authors ?? [];
  const authorByKey = prepared?.authorByKey ?? {};
  const timeline = prepared?.timeline;
  const applyTopLongCommitFilter = barChartMode === 'lines' && excludeTopLongCommits;

  const topLongestCommitIds = useMemo(
    () => buildTopLongestCommitIdSet(timeline?.nodes ?? [], 0.05),
    [timeline]
  );

  const activeExcludedCommitIds = applyTopLongCommitFilter ? topLongestCommitIds : null;

  const applySelection = useCallback((nodes, selectedIndex) => {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      setVisibleNodeCount(0);
      setFocusLineY(0);
      setSelectedId(null);
      return;
    }

    const clampedIndex = Math.max(0, Math.min(nodes.length - 1, selectedIndex));
    const selectedNode = nodes[clampedIndex];
    const nextCount = clampedIndex + 1;

    setVisibleNodeCount((prev) => (prev === nextCount ? prev : nextCount));
    setFocusLineY((prev) => (prev === selectedNode.y ? prev : selectedNode.y));
    setSelectedId((prev) => (prev === selectedNode.id ? prev : selectedNode.id));
  }, []);

  useEffect(() => {
    if (!timeline?.nodes?.length) {
      applySelection([], 0);
      return;
    }

    const scrollElement = timelineScrollRef.current;
    if (!scrollElement) {
      applySelection(timeline.nodes, timeline.nodes.length - 1);
      return;
    }

    let frameId = 0;
    let ticking = false;

    const updateVisibleCount = () => {
      const maxScrollTop = Math.max(1, scrollElement.scrollHeight - scrollElement.clientHeight);
      const progress = Math.min(1, Math.max(0, scrollElement.scrollTop / maxScrollTop));
      const targetY = scrollElement.scrollTop + scrollElement.clientHeight * progress;
      const selectedIndex = findNearestNodeIndex(timeline.nodes, targetY);
      applySelection(timeline.nodes, selectedIndex);
    };

    const scheduleUpdate = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      frameId = window.requestAnimationFrame(() => {
        ticking = false;
        updateVisibleCount();
      });
    };

    updateVisibleCount();
    scrollElement.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      scrollElement.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [applySelection, timeline]);

  const cumulativeRows = useMemo(() => {
    if (!timeline?.nodes?.length) {
      return buildCumulativeRows(
        projects,
        authors,
        [],
        subtractDeletions,
        activeExcludedCommitIds
      );
    }
    const clampedCount = Math.max(0, Math.min(visibleNodeCount, timeline.nodes.length));
    return buildCumulativeRows(
      projects,
      authors,
      timeline.nodes.slice(0, clampedCount),
      subtractDeletions,
      activeExcludedCommitIds
    );
  }, [authors, projects, timeline, visibleNodeCount, subtractDeletions, activeExcludedCommitIds]);

  const commitAxisMax = useMemo(
    () => Math.max(1, ...commitRows.map((row) => Number(row.total) || 0)),
    [commitRows]
  );

  const fullLineRows = useMemo(() => {
    if (!timeline?.nodes?.length) {
      return buildCumulativeRows(
        projects,
        authors,
        [],
        subtractDeletions,
        activeExcludedCommitIds
      ).lineRows;
    }
    return buildCumulativeRows(
      projects,
      authors,
      timeline.nodes,
      subtractDeletions,
      activeExcludedCommitIds
    ).lineRows;
  }, [authors, projects, timeline, subtractDeletions, activeExcludedCommitIds]);

  const lineAxisDomain = useMemo(() => {
    if (!subtractDeletions) {
      const max = Math.max(1, ...fullLineRows.map((row) => Number(row.total) || 0));
      return [0, max];
    }

    const totals = fullLineRows.map((row) => Number(row.total) || 0);
    const min = Math.min(0, ...totals);
    const max = Math.max(0, ...totals);

    if (min === max) {
      return [min - 1, max + 1];
    }

    return [min, max];
  }, [fullLineRows, subtractDeletions]);

  const projectTrendSeries = useMemo(
    () => buildProjectTrendSeries(projects, commitRows, authors),
    [projects, commitRows, authors]
  );

  const projectTrendRows = useMemo(() => {
    if (!timeline?.nodes?.length) {
      return [];
    }
    return buildProjectTrendRows(
      timeline.nodes,
      projectTrendSeries,
      trendMetric,
      subtractDeletions,
      activeExcludedCommitIds
    );
  }, [timeline, projectTrendSeries, trendMetric, subtractDeletions, activeExcludedCommitIds]);

  const authorTrendSeries = useMemo(
    () => buildAuthorTrendSeries(authors),
    [authors]
  );

  const authorTrendRows = useMemo(() => {
    if (!timeline?.nodes?.length) {
      return [];
    }
    return buildAuthorTrendRows(
      timeline.nodes,
      authorTrendSeries,
      trendMetric,
      subtractDeletions,
      activeExcludedCommitIds
    );
  }, [timeline, authorTrendSeries, trendMetric, subtractDeletions, activeExcludedCommitIds]);

  const activeTrendRows = trendScope === 'byProject' ? projectTrendRows : authorTrendRows;
  const activeTrendSeries = trendScope === 'byProject' ? projectTrendSeries : authorTrendSeries;

  const trendDomain = useMemo(() => {
    if (activeTrendRows.length === 0) {
      return [0, 1];
    }

    const values = activeTrendRows.flatMap((row) =>
      activeTrendSeries.map((line) => Number(row[line.key]) || 0)
    );

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return [min - 1, max + 1];
    }
    return [min, max];
  }, [activeTrendRows, activeTrendSeries]);

  const selectedTrendPoint = useMemo(() => {
    if (activeTrendRows.length === 0) {
      return null;
    }
    const index = Math.max(0, Math.min(activeTrendRows.length - 1, visibleNodeCount - 1));
    return activeTrendRows[index];
  }, [activeTrendRows, visibleNodeCount]);

  const activeStackRows = barChartMode === 'commits' ? cumulativeRows.commitRows : cumulativeRows.lineRows;
  const activeStackUnit = barChartMode === 'commits'
    ? 'commit'
    : (subtractDeletions ? 'net line' : 'line');
  const activeStackTitle = barChartMode === 'commits'
    ? '커밋 수 (프로젝트 x 작성자)'
    : '라인 수 (프로젝트 x 작성자)';
  const activeStackDescription = barChartMode === 'commits'
    ? '타임라인 스크롤 위치까지의 누적 커밋 수입니다.'
    : '타임라인 스크롤 위치까지의 누적 `+`/`-` diff 라인입니다.';
  const activeStackDomain = barChartMode === 'commits' ? [0, commitAxisMax] : lineAxisDomain;
  const trendUnitLabel = trendMetric === 'commits'
    ? '커밋 수'
    : (subtractDeletions ? '라인 수(추가-삭제)' : '라인 수(추가+삭제)');
  const trendDescription = trendScope === 'byProject'
    ? `시간에 따른 레포별 누적 ${trendUnitLabel}입니다.`
    : `시간에 따른 사용자별 누적 ${trendUnitLabel}입니다.`;

  const ignoredRuleCount = identityRules.invalidLines.length;
  const ignoredDraftRuleCount = draftIdentityRules.invalidLines.length;

  if (loading) {
    return (
      <div className="center-screen">
        <Loader color="dark" size="lg" />
        <Text size="sm" c="dimmed">커밋 데이터를 불러오는 중...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-screen">
        <Alert
          variant="light"
          color="gray"
          title="오류"
          icon={<IconAlertCircle size={16} />}
        >
          {error}
        </Alert>
      </div>
    );
  }

  if (!prepared || !timeline) {
    return null;
  }

  return (
    <main className="app-shell">
      <section className="left-pane">
        <div className="pane-scroll">
          <Card className="chart-card card-enter delay-2" radius="xl" p="lg" withBorder>
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap="xs" className="stack-chart-copy">
                <Title order={4}>{activeStackTitle}</Title>
                <Text size="sm" c="dimmed" className="stack-chart-description">
                  {activeStackDescription}
                </Text>
              </Stack>
              <Group gap="xs">
                <Button
                  size="xs"
                  color="dark"
                  variant={barChartMode === 'commits' ? 'filled' : 'default'}
                  onClick={() => setBarChartMode('commits')}
                >
                  커밋 수
                </Button>
                <Button
                  size="xs"
                  color="dark"
                  variant={barChartMode === 'lines' ? 'filled' : 'default'}
                  onClick={() => setBarChartMode('lines')}
                >
                  라인 수
                </Button>
              </Group>
            </Group>
            <div className="stack-chart-option-slot">
              {barChartMode === 'lines' && (
                <Group gap="lg">
                  <Checkbox
                    size="sm"
                    color="dark"
                    checked={subtractDeletions}
                    onChange={(event) => setSubtractDeletions(event.currentTarget.checked)}
                    label="삭제(-)를 빼서 보기"
                  />
                  <Checkbox
                    size="sm"
                    color="dark"
                    checked={excludeTopLongCommits}
                    onChange={(event) => setExcludeTopLongCommits(event.currentTarget.checked)}
                    label="레포별 상위 5% 긴 커밋 제외"
                  />
                </Group>
              )}
            </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeStackRows} margin={{ top: 20, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d3d3d3" />
                  <XAxis dataKey="projectLabel" />
                  <YAxis allowDecimals={false} domain={activeStackDomain} />
                  {barChartMode === 'lines' && subtractDeletions && (
                    <ReferenceLine y={0} stroke="#8f8f8f" strokeDasharray="4 4" />
                  )}
                  <Tooltip
                    content={
                      <StackedTooltip
                        authorByKey={authorByKey}
                        unitLabel={activeStackUnit}
                      />
                    }
                  />
                  {authors.map((author) => (
                    <Bar
                      key={author.key}
                      dataKey={author.key}
                      stackId={barChartMode}
                      fill={author.color}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="chart-card card-enter delay-3" radius="xl" p="lg" withBorder>
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Stack gap="xs">
                <Title order={4}>시간 추이</Title>
                <Text size="sm" c="dimmed">
                  {trendDescription}
                </Text>
              </Stack>
              <Stack gap="xs" align="flex-end">
                <Group gap="xs">
                  <Button
                    size="xs"
                    color="dark"
                    variant={trendScope === 'byProject' ? 'filled' : 'default'}
                    onClick={() => setTrendScope('byProject')}
                  >
                    레포별
                  </Button>
                  <Button
                    size="xs"
                    color="dark"
                    variant={trendScope === 'byAuthor' ? 'filled' : 'default'}
                    onClick={() => setTrendScope('byAuthor')}
                  >
                    사용자별
                  </Button>
                </Group>
              </Stack>
            </Group>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeTrendRows} margin={{ top: 20, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d3d3d3" />
                  <XAxis
                    dataKey="timestampMs"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(value) => formatKoreanDateTime(value)}
                    tickCount={6}
                  />
                  <YAxis allowDecimals={false} domain={trendDomain} />
                  {trendMetric === 'code' && subtractDeletions && (
                    <ReferenceLine y={0} stroke="#8f8f8f" strokeDasharray="4 4" />
                  )}
                  {selectedTrendPoint && (
                    <ReferenceLine x={selectedTrendPoint.timestampMs} stroke="#8f8f8f" strokeDasharray="4 4" />
                  )}
                  <Tooltip
                    labelFormatter={(value) => formatKoreanDateTime(value)}
                    formatter={(value, name) => [
                      formatNumber(value),
                      name,
                    ]}
                  />
                  {activeTrendSeries.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      name={series.label}
                      dataKey={series.key}
                      stroke={series.stroke}
                      strokeDasharray={series.dash}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

        </div>
      </section>

      <section className="right-pane">
        <Paper className="timeline-card" radius="xl" p="lg" withBorder>
          <div className="timeline-head">
            <div>
              <Title order={2}>Commit History Timeline</Title>
              <Text c="dimmed" size="sm">
                프로젝트 라인 3개 위에 시간 순 커밋을 배치하고, 선후/작성자 전환 관계를 함께 표시합니다.
              </Text>
            </div>
            <Group gap="xs" align="center">
              {ignoredRuleCount > 0 && (
                <Badge color="gray" variant="light">무시된 규칙 {ignoredRuleCount}개</Badge>
              )}
              <Button
                size="xs"
                color="dark"
                variant="default"
                onClick={() => {
                  setDraftIdentityRulesText(identityRulesText);
                  setIsIdentityModalOpen(true);
                }}
              >
                작성자 병합 규칙
              </Button>
            </Group>
          </div>

          <Paper withBorder radius="md" p="sm" mb="sm" className="selected-commit-box">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Selected Commit</Text>
            <Text fw={700}>{selectedCommitText(selectedNode)}</Text>
            {selectedNode && (
              <Group gap="xs" mt={6}>
                <Badge color="gray" variant="light">+{formatNumber(selectedNode.additions)}</Badge>
                <Badge color="gray" variant="light">-{formatNumber(selectedNode.deletions)}</Badge>
                <Badge
                  variant="light"
                  styles={{
                    root: {
                      backgroundColor: `${selectedNode.authorColor}26`,
                      color: '#111111',
                      borderColor: `${selectedNode.authorColor}66`,
                    },
                  }}
                >
                  {selectedNode.authorName}
                </Badge>
              </Group>
            )}
          </Paper>

          <div className="timeline-scroll" ref={timelineScrollRef}>
            <svg
              width={timeline.width}
              height={timeline.height}
              viewBox={`0 0 ${timeline.width} ${timeline.height}`}
              className="timeline-canvas"
              role="img"
              aria-label="Commit timeline"
            >
              <defs>
                <marker
                  id="precedence-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#7b7b7b" opacity="0.6" />
                </marker>
              </defs>

              {timeline.lanes.map((lane) => (
                <g key={lane.id}>
                  <line
                    x1={lane.x}
                    y1={timeline.topPadding - 30}
                    x2={lane.x}
                    y2={timeline.height - 32}
                    className="timeline-lane-line"
                  />
                  <rect
                    x={lane.x - 88}
                    y={18}
                    width={176}
                    height={34}
                    rx={12}
                    className="timeline-lane-pill"
                  />
                  <text
                    x={lane.x}
                    y={40}
                    textAnchor="middle"
                    className="timeline-lane-label"
                  >
                    {lane.label}
                  </text>
                </g>
              ))}

              {timeline.precedenceEdges.map((edge, index) => (
                <path
                  key={`precedence-${index}`}
                  d={edge.path}
                  className={buildEdgeClass('precedence')}
                  markerEnd="url(#precedence-arrow)"
                />
              ))}

              {timeline.projectEdges.map((edge, index) => (
                <path
                  key={`project-${index}`}
                  d={edge.path}
                  className={buildEdgeClass('project')}
                />
              ))}

              {timeline.authorEdges.map((edge, index) => (
                <path
                  key={`author-${index}`}
                  d={edge.path}
                  className={buildEdgeClass('author')}
                  style={{ stroke: edge.color }}
                />
              ))}

              {selectedNode && focusLineY > 0 && (
                <g className="timeline-focus-guide" style={{ pointerEvents: 'none' }}>
                  <line
                    x1={24}
                    y1={focusLineY}
                    x2={timeline.width - 24}
                    y2={focusLineY}
                    className="timeline-focus-line"
                  />
                </g>
              )}

              {timeline.nodes.map((node, index) => {
                const isSelected = selectedNode?.id === node.id;
                return (
                  <g
                    key={node.id}
                    onClick={() => applySelection(timeline.nodes, index)}
                    className={`timeline-node ${isSelected ? 'is-selected' : ''}`}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius + 1.5}
                      className="timeline-node-ring"
                    />
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill={node.authorColor}
                      className="timeline-node-dot"
                    />
                    <title>
                      {`${node.authorName}\n${node.lane?.label} · ${node.commitShortHash}\n${formatKoreanDateTime(node.timestampMs)}\n+${node.additions} / -${node.deletions}\n${node.title}`}
                    </title>
                  </g>
                );
              })}
            </svg>
          </div>
        </Paper>
      </section>

      <Modal
        opened={isIdentityModalOpen}
        onClose={() => setIsIdentityModalOpen(false)}
        title="작성자 병합 규칙 (1:1)"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            한 줄에 한 쌍씩 입력하세요. 형식: 사용자A - 사용자B 또는 사용자A → 사용자B
          </Text>
          <Textarea
            minRows={7}
            autosize
            value={draftIdentityRulesText}
            onChange={(event) => setDraftIdentityRulesText(event.currentTarget.value)}
            placeholder={'Seo Minseok - user983740\n사용자1 - 나도사용자1\n나도사용자1 - 나역시사용자1'}
          />
          {ignoredDraftRuleCount > 0 && (
            <Text size="xs" c="dimmed">
              형식이 맞지 않은 줄 {ignoredDraftRuleCount}개는 적용 시 무시됩니다.
            </Text>
          )}
          <Group justify="space-between">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => setDraftIdentityRulesText(DEFAULT_IDENTITY_RULES_TEXT)}
            >
              기본값 복원
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={() => setIsIdentityModalOpen(false)}>
                취소
              </Button>
              <Button
                color="dark"
                onClick={() => {
                  setIdentityRulesText(draftIdentityRulesText);
                  setIsIdentityModalOpen(false);
                }}
              >
                적용
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
}
