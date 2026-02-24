import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  Slider,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatKoreanDateTime, formatNumber, processLogData } from './logData';

const DEFAULT_IDENTITY_RULES_TEXT = 'Seo Minseok - user983740';
const DEFAULT_IDENTITY_RULES_FILE = 'author_identity_rules.txt';
const IDENTITY_RULES_STORAGE_KEY = 'wackathon-identity-rules';
const DEFAULT_TOP_LONG_COMMIT_PERCENT = 15;
const STATIC_DATA_MANIFEST_PATH = 'data/manifest.json';
const IS_STATIC_BUILD = import.meta.env.PROD;
const BATTLE_TIMELINE_START_MS = Date.parse('2026-02-21T15:00:00+09:00');
const BATTLE_TIMELINE_END_MS = Date.parse('2026-02-22T09:00:00+09:00');

const TEAM_BASE_COLORS = [
  '#1d4ed8',
  '#dc2626',
  '#0f766e',
  '#9333ea',
  '#ca8a04',
  '#0891b2',
  '#be123c',
  '#475569',
  '#ea580c',
  '#15803d',
  '#7c2d12',
  '#334155',
];

function resolveAppAssetUrl(relativePath) {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return `${normalizedBase}${normalizedPath}`;
}

async function fetchStaticDataManifest() {
  const res = await fetch(resolveAppAssetUrl(STATIC_DATA_MANIFEST_PATH));
  if (!res.ok) {
    throw new Error(`정적 데이터 manifest 로드 실패: ${res.status}`);
  }
  return res.json();
}

function normalizeFileEntries(items, extension) {
  const files = Array.isArray(items) ? items : [];
  return files
    .map((item) => ({
      name: typeof item?.name === 'string' ? item.name : '',
      sizeBytes: Number(item?.sizeBytes) || 0,
      modifiedAtMs: Number(item?.modifiedAtMs) || 0,
      path: typeof item?.path === 'string' ? item.path : null,
    }))
    .filter((item) => item.name && item.name.endsWith(extension))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function teamIdFromFileName(fileName = '') {
  return String(fileName).replace(/\.json$/i, '').trim() || 'unknown-team';
}

function withAlpha(hexColor, alpha = 1) {
  const source = String(hexColor || '').trim();
  const expanded = source.length === 4
    ? `#${source[1]}${source[1]}${source[2]}${source[2]}${source[3]}${source[3]}`
    : source;
  const matched = /^#?([0-9a-f]{6})$/i.exec(expanded);
  if (!matched) {
    return hexColor;
  }
  const raw = matched[1];
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function readStoredIdentityRulesText() {
  if (typeof window === 'undefined') {
    return '';
  }
  return String(window.localStorage.getItem(IDENTITY_RULES_STORAGE_KEY) || '').trim();
}

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
    splitBy('->')
    ?? splitBy(' - ')
    ?? splitBy(',')
    ?? splitBy('\t')
    ?? (() => {
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

async function loadDefaultIdentityRulesText() {
  if (IS_STATIC_BUILD) {
    const manifest = await fetchStaticDataManifest();
    const files = normalizeFileEntries(manifest?.identityRuleFiles, '.txt');
    const selectedFile = files.find((item) => item.name === DEFAULT_IDENTITY_RULES_FILE) ?? files[0];
    if (!selectedFile?.path) {
      return DEFAULT_IDENTITY_RULES_TEXT;
    }
    const res = await fetch(resolveAppAssetUrl(selectedFile.path));
    if (!res.ok) {
      throw new Error(`규칙 파일 로드 실패: ${res.status}`);
    }
    return res.text();
  }

  const res = await fetch(`/api/identity-rule-file?file=${encodeURIComponent(DEFAULT_IDENTITY_RULES_FILE)}`);
  if (!res.ok) {
    throw new Error(`규칙 파일 로드 실패: ${res.status}`);
  }
  return res.text();
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

function buildTopLongestCommitIdSet(nodes, topPercent = 0.1) {
  if (!Array.isArray(nodes) || nodes.length === 0 || topPercent <= 0) {
    return new Set();
  }

  const byRepo = new Map();
  for (const node of nodes) {
    const repoId = node.repoId ?? '__unknown_repo__';
    if (!byRepo.has(repoId)) {
      byRepo.set(repoId, []);
    }
    byRepo.get(repoId).push(node);
  }

  const excludedIds = new Set();
  for (const repoNodes of byRepo.values()) {
    const removeCount = Math.ceil(repoNodes.length * topPercent);
    if (removeCount <= 0) {
      continue;
    }

    const ranked = repoNodes
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

function buildZeroLengthCommitIdSet(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return new Set();
  }

  const excludedIds = new Set();
  for (const node of nodes) {
    if (commitLength(node) === 0) {
      excludedIds.add(node.id);
    }
  }
  return excludedIds;
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

function pickTopMapKey(countMap, fallbackValue = null) {
  let topKey = fallbackValue;
  let topValue = -1;
  for (const [key, value] of countMap.entries()) {
    const score = Number(value) || 0;
    if (score > topValue) {
      topKey = key;
      topValue = score;
    }
  }
  return topKey;
}

function pickUserStrokeByTeam(baseColor, orderInTeam) {
  const alphaSteps = [0.68, 0.58, 0.48, 0.4, 0.34, 0.28];
  const alpha = alphaSteps[orderInTeam % alphaSteps.length];
  return withAlpha(baseColor, alpha);
}

function buildPreparedTeamBattle(teamPayloads, identityPairs = []) {
  if (!Array.isArray(teamPayloads) || teamPayloads.length === 0) {
    return {
      nodes: [],
      teams: [],
      teamTotalSeries: [],
      authorSeries: [],
      authorKeyById: new Map(),
    };
  }

  const teamOrder = [];
  const teamById = new Map();
  const nodes = [];
  const authorStatsById = new Map();

  for (const teamPayload of teamPayloads) {
    const teamId = teamIdFromFileName(teamPayload.fileName);
    if (!teamById.has(teamId)) {
      teamById.set(teamId, {
        id: teamId,
        label: teamId,
      });
      teamOrder.push(teamId);
    }

    const prepared = processLogData(teamPayload.payload, { identityPairs });

    for (const node of prepared.timeline?.nodes ?? []) {
      const repoId = `${teamId}::${node.projectId}`;
      const transformed = {
        id: `${teamId}:${node.id}`,
        teamId,
        repoId,
        projectId: repoId,
        timestampMs: Number(node.timestampMs) || 0,
        sourceOrder: Number(node.sourceOrder) || 0,
        sourceCommitIndex: Number(node.sourceCommitIndex) || 0,
        additions: Number(node.additions) || 0,
        deletions: Number(node.deletions) || 0,
        touchedLines: Number(node.touchedLines) || 0,
        authorId: String(node.authorId || 'unknown-author'),
        authorName: String(node.authorName || node.authorFallbackName || 'Unknown'),
      };
      nodes.push(transformed);

      if (!authorStatsById.has(transformed.authorId)) {
        authorStatsById.set(transformed.authorId, {
          id: transformed.authorId,
          commits: 0,
          lines: 0,
          names: new Map(),
          teamCounts: new Map(),
        });
      }
      const authorStats = authorStatsById.get(transformed.authorId);
      authorStats.commits += 1;
      authorStats.lines += transformed.touchedLines;
      authorStats.names.set(
        transformed.authorName,
        (authorStats.names.get(transformed.authorName) ?? 0) + 1
      );
      authorStats.teamCounts.set(
        transformed.teamId,
        (authorStats.teamCounts.get(transformed.teamId) ?? 0) + 1
      );
    }
  }

  const teamIndexMap = new Map(teamOrder.map((teamId, index) => [teamId, index]));
  nodes.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) {
      return a.timestampMs - b.timestampMs;
    }
    const teamDiff = (teamIndexMap.get(a.teamId) ?? 0) - (teamIndexMap.get(b.teamId) ?? 0);
    if (teamDiff !== 0) {
      return teamDiff;
    }
    if (a.sourceOrder !== b.sourceOrder) {
      return a.sourceOrder - b.sourceOrder;
    }
    if (a.sourceCommitIndex !== b.sourceCommitIndex) {
      return a.sourceCommitIndex - b.sourceCommitIndex;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  const teams = teamOrder.map((teamId, index) => ({
    ...teamById.get(teamId),
    color: TEAM_BASE_COLORS[index % TEAM_BASE_COLORS.length],
  }));

  const teamColorById = new Map(teams.map((team) => [team.id, team.color]));

  const teamTotalSeries = teams.map((team, index) => ({
    id: team.id,
    key: `team_total_${index}`,
    teamId: team.id,
    label: `${team.label} 합계`,
    stroke: team.color,
    strokeWidth: 2,
    opacity: 1,
    isTeamTotal: true,
  }));

  const sortedAuthors = [...authorStatsById.values()]
    .map((author) => ({
      id: author.id,
      displayName: pickDisplayName(author.names),
      commits: author.commits,
      lines: author.lines,
      dominantTeamId: pickTopMapKey(author.teamCounts, teamOrder[0] ?? null),
    }))
    .sort((a, b) => (
      b.commits - a.commits
      || b.lines - a.lines
      || a.displayName.localeCompare(b.displayName)
    ));
  const colorOrderByTeam = new Map();
  const authorSeries = sortedAuthors.map((author, index) => {
      const teamId = author.dominantTeamId;
      const orderInTeam = colorOrderByTeam.get(teamId) ?? 0;
      colorOrderByTeam.set(teamId, orderInTeam + 1);
      const teamColor = teamColorById.get(teamId) ?? '#64748b';

      return {
        id: author.id,
        key: `author_${index}`,
        teamId,
        label: author.displayName,
        stroke: pickUserStrokeByTeam(teamColor, orderInTeam),
        strokeWidth: 1.1,
        opacity: 0.95,
        isTeamTotal: false,
      };
    });

  const authorKeyById = new Map(authorSeries.map((author) => [author.id, author.key]));

  return {
    nodes,
    teams,
    teamTotalSeries,
    authorSeries,
    authorKeyById,
  };
}

function buildTeamRows(
  nodes,
  teamTotalSeries,
  metric,
  subtractDeletions = false,
  showPercent = false,
  excludedCommitIds = null
) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const totalsByTeamId = Object.fromEntries(teamTotalSeries.map((series) => [series.id, 0]));

  return nodes.map((node, index) => {
    if (!excludedCommitIds?.has(node.id)) {
      const delta = trendDelta(node, metric, subtractDeletions);
      if (Object.prototype.hasOwnProperty.call(totalsByTeamId, node.teamId)) {
        totalsByTeamId[node.teamId] += delta;
      }
    }

    const row = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
    };

    if (!showPercent) {
      for (const series of teamTotalSeries) {
        row[series.key] = Number(totalsByTeamId[series.id]) || 0;
      }
      return row;
    }

    const denominator = teamTotalSeries.reduce(
      (sum, series) => sum + Math.abs(Number(totalsByTeamId[series.id]) || 0),
      0
    );

    for (const series of teamTotalSeries) {
      const value = Number(totalsByTeamId[series.id]) || 0;
      row[series.key] = denominator > 0 ? (value / denominator) * 100 : 0;
    }

    return row;
  });
}

function buildAuthorRows(
  nodes,
  authorSeries,
  authorKeyById,
  metric,
  subtractDeletions = false,
  showPercent = false,
  excludedCommitIds = null
) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const totalsByAuthorKey = Object.fromEntries(authorSeries.map((series) => [series.key, 0]));

  return nodes.map((node, index) => {
    if (!excludedCommitIds?.has(node.id)) {
      const delta = trendDelta(node, metric, subtractDeletions);
      const authorKey = authorKeyById.get(node.authorId);
      if (authorKey && Object.prototype.hasOwnProperty.call(totalsByAuthorKey, authorKey)) {
        totalsByAuthorKey[authorKey] += delta;
      }
    }

    const row = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
    };

    if (!showPercent) {
      for (const series of authorSeries) {
        row[series.key] = Number(totalsByAuthorKey[series.key]) || 0;
      }
      return row;
    }

    const denominator = authorSeries.reduce(
      (sum, series) => sum + Math.abs(Number(totalsByAuthorKey[series.key]) || 0),
      0
    );

    for (const series of authorSeries) {
      const value = Number(totalsByAuthorKey[series.key]) || 0;
      row[series.key] = denominator > 0 ? (value / denominator) * 100 : 0;
    }

    return row;
  });
}

function toNumericInputValue(rawValue) {
  if (rawValue === '' || rawValue === null || rawValue === undefined) {
    return '';
  }
  return String(rawValue);
}

function buildStackValueBounds(rows, series) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(series) || series.length === 0) {
    return [0, 1];
  }

  let min = 0;
  let max = 0;

  for (const row of rows) {
    let positive = 0;
    let negative = 0;

    for (const item of series) {
      const value = Number(row[item.key]) || 0;
      if (value >= 0) {
        positive += value;
      } else {
        negative += value;
      }
    }

    max = Math.max(max, positive);
    min = Math.min(min, negative);
  }

  if (min === max) {
    if (min === 0) {
      return [0, 1];
    }
    return [min - 1, max + 1];
  }

  return [min, max];
}

function buildSeriesValueBounds(rows, series) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(series) || series.length === 0) {
    return [0, 1];
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    for (const item of series) {
      const value = Number(row[item.key]);
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  if (min === max) {
    if (min === 0) {
      return [0, 1];
    }
    return [min - 1, max + 1];
  }

  return [min, max];
}

function formatBattleMomentShort(timestampMs) {
  const date = new Date(Number(timestampMs) || 0);
  if (!Number.isFinite(date.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date);
}

function TeamStackedTooltip({
  active,
  payload,
  label,
  authorByKey,
  unitLabel,
  valueFormatter = formatNumber,
}) {
  if (!active || !Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const normalized = payload
    .filter((item) => {
      const value = Number(item.value);
      return Number.isFinite(value) && value !== 0;
    })
    .sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)));

  if (normalized.length === 0) {
    return null;
  }

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
                <Text size="sm">{author?.label ?? item.dataKey}</Text>
              </Group>
              <Text size="sm" fw={700}>{valueFormatter(item.value)} {unitLabel}</Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

function TeamLineTooltip({
  active,
  payload,
  label,
  seriesByKey,
  valueFormatter = formatNumber,
  showPercent = false,
}) {
  if (!active || !Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const normalized = payload
    .filter((item) => Number.isFinite(Number(item.value)))
    .sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)));

  if (!normalized.length) {
    return null;
  }
  const tooltipLabel = normalized[0]?.payload?.shortLabel ?? normalized[0]?.payload?.label ?? label;

  return (
    <Paper shadow="md" radius="md" p="sm" withBorder className="chart-tooltip">
      <Text fw={700} mb={6}>{tooltipLabel}</Text>
      <Stack gap={4}>
        {normalized.map((item) => {
          const series = seriesByKey[item.dataKey];
          const value = Number(item.value) || 0;
          const valueText = showPercent
            ? `${Number(value).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
            : valueFormatter(value);
          return (
            <Group key={`${item.dataKey}-${label}`} justify="space-between" gap="xl">
              <Group gap={8}>
                <span
                  className="swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <Text size="sm">{series?.label ?? item.name ?? item.dataKey}</Text>
              </Group>
              <Text size="sm" fw={700}>{valueText}</Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

export default function TeamBattleView({ colorScheme = 'light' }) {
  const [teamPayloads, setTeamPayloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fileListLoading, setFileListLoading] = useState(true);
  const [error, setError] = useState('');
  const [identityRuleError, setIdentityRuleError] = useState('');
  const [identityRulesText, setIdentityRulesText] = useState(
    () => readStoredIdentityRulesText() || DEFAULT_IDENTITY_RULES_TEXT
  );
  const [logFiles, setLogFiles] = useState([]);

  const [metricMode, setMetricMode] = useState('commits');
  const [showProjectPercent] = useState(false);
  const [excludeTopLongCommits, setExcludeTopLongCommits] = useState(false);
  const [excludeZeroLengthCommit, setExcludeZeroLengthCommit] = useState(false);
  const [subtractDeletions, setSubtractDeletions] = useState(false);
  const [topLongCommitPercentInput, setTopLongCommitPercentInput] = useState(
    String(DEFAULT_TOP_LONG_COMMIT_PERCENT)
  );
  const [activeTrendIndex, setActiveTrendIndex] = useState(null);

  const linkedMetricOptionChecked = metricMode === 'commits'
    ? excludeZeroLengthCommit
    : subtractDeletions;

  const setLinkedMetricOptionChecked = useCallback((nextChecked) => {
    const checked = Boolean(nextChecked);
    setExcludeZeroLengthCommit(checked);
    setSubtractDeletions(checked);
  }, []);

  const identityRules = useMemo(
    () => parseIdentityRules(identityRulesText),
    [identityRulesText]
  );

  const actionButtonColor = colorScheme === 'dark' ? 'gray' : 'dark';
  const chartGridStroke = colorScheme === 'dark' ? 'rgba(181, 197, 227, 0.25)' : 'rgba(24, 24, 24, 0.14)';
  const chartReferenceStroke = colorScheme === 'dark' ? 'rgba(218, 228, 248, 0.6)' : 'rgba(24, 24, 24, 0.45)';
  const chartTickColor = colorScheme === 'dark' ? '#c0cbdf' : '#575757';
  const chartAxisStroke = colorScheme === 'dark' ? '#7b879f' : '#9b9b9b';

  const loadLogFiles = useCallback(async () => {
    setFileListLoading(true);

    try {
      let files = [];
      if (IS_STATIC_BUILD) {
        const manifest = await fetchStaticDataManifest();
        files = normalizeFileEntries(manifest?.commitLogs, '.json');
      } else {
        const res = await fetch('/api/commit-logs');
        if (!res.ok) {
          throw new Error(`파일 목록 로드 실패: ${res.status}`);
        }
        const data = await res.json();
        files = normalizeFileEntries(data?.files, '.json');
      }

      setLogFiles(files);
      if (files.length === 0) {
        setTeamPayloads([]);
        setError(
          IS_STATIC_BUILD
            ? '선택 가능한 JSON 파일이 없습니다. build 전에 `npm run prepare:data`를 실행하세요.'
            : '선택 가능한 JSON 파일이 없습니다. commit_crawler/json을 확인하세요.'
        );
      } else {
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogFiles();
  }, [loadLogFiles]);

  useEffect(() => {
    let mounted = true;
    async function loadRules() {
      try {
        const storedRules = readStoredIdentityRulesText();
        if (storedRules) {
          if (!mounted) {
            return;
          }
          setIdentityRulesText(storedRules);
          setIdentityRuleError('');
          return;
        }

        const text = await loadDefaultIdentityRulesText();
        if (!mounted) {
          return;
        }
        setIdentityRulesText(text);
        setIdentityRuleError('');
      } catch (err) {
        if (!mounted) {
          return;
        }
        setIdentityRulesText(DEFAULT_IDENTITY_RULES_TEXT);
        setIdentityRuleError(err instanceof Error ? err.message : String(err));
      }
    }

    loadRules();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(IDENTITY_RULES_STORAGE_KEY, identityRulesText);
  }, [identityRulesText]);

  useEffect(() => {
    if (!logFiles.length) {
      setLoading(false);
      return;
    }

    let mounted = true;
    async function loadAllTeamPayloads() {
      try {
        setLoading(true);

        const loaded = await Promise.all(logFiles.map(async (file) => {
          let res;
          if (IS_STATIC_BUILD) {
            if (!file.path) {
              throw new Error(`${file.name}: 정적 경로가 없습니다.`);
            }
            res = await fetch(resolveAppAssetUrl(file.path));
          } else {
            res = await fetch(`/api/commit-log?file=${encodeURIComponent(file.name)}`);
          }
          if (!res.ok) {
            throw new Error(`${file.name}: 데이터 로드 실패(${res.status})`);
          }
          const payload = await res.json();
          return {
            fileName: file.name,
            payload,
          };
        }));

        if (mounted) {
          setTeamPayloads(loaded);
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

    loadAllTeamPayloads();
    return () => {
      mounted = false;
    };
  }, [logFiles]);

  const prepared = useMemo(
    () => buildPreparedTeamBattle(teamPayloads, identityRules.pairs),
    [teamPayloads, identityRules]
  );

  const nodes = prepared.nodes;
  const teamTotalSeries = prepared.teamTotalSeries;
  const authorSeries = prepared.authorSeries;
  const authorKeyById = prepared.authorKeyById;
  const teams = prepared.teams;

  const topLongCommitPercent = useMemo(() => {
    if (topLongCommitPercentInput === '') {
      return 0;
    }
    const parsed = Number(topLongCommitPercentInput);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.min(100, Math.max(0, parsed));
  }, [topLongCommitPercentInput]);

  const topLongestCommitIds = useMemo(
    () => buildTopLongestCommitIdSet(nodes, topLongCommitPercent / 100),
    [nodes, topLongCommitPercent]
  );

  const zeroLengthCommitIds = useMemo(
    () => buildZeroLengthCommitIdSet(nodes),
    [nodes]
  );

  const activeExcludedCommitIds = useMemo(() => {
    if (!excludeTopLongCommits && !excludeZeroLengthCommit) {
      return null;
    }

    const excluded = new Set();
    if (excludeTopLongCommits) {
      for (const id of topLongestCommitIds) {
        excluded.add(id);
      }
    }
    if (excludeZeroLengthCommit) {
      for (const id of zeroLengthCommitIds) {
        excluded.add(id);
      }
    }
    return excluded;
  }, [excludeTopLongCommits, excludeZeroLengthCommit, topLongestCommitIds, zeroLengthCommitIds]);

  const timelineWindowNodes = useMemo(
    () => nodes.filter((node) => {
      const timestampMs = Number(node.timestampMs) || 0;
      return timestampMs >= BATTLE_TIMELINE_START_MS && timestampMs <= BATTLE_TIMELINE_END_MS;
    }),
    [nodes]
  );

  const activeTeamIdsInWindow = useMemo(() => {
    const ids = new Set();
    for (const node of timelineWindowNodes) {
      if (activeExcludedCommitIds?.has(node.id)) {
        continue;
      }
      ids.add(node.teamId);
    }
    return ids;
  }, [timelineWindowNodes, activeExcludedCommitIds]);

  const metricForTrend = metricMode === 'commits' ? 'commits' : 'code';
  const useNetLines = metricMode === 'lines' && subtractDeletions;

  const teamRows = useMemo(
    () => buildTeamRows(
      timelineWindowNodes,
      teamTotalSeries,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds
    ),
    [
      timelineWindowNodes,
      teamTotalSeries,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds,
    ]
  );

  const authorRows = useMemo(
    () => buildAuthorRows(
      timelineWindowNodes,
      authorSeries,
      authorKeyById,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds
    ),
    [
      timelineWindowNodes,
      authorSeries,
      authorKeyById,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds,
    ]
  );

  const activeTrendRows = useMemo(() => {
    if (!teamRows.length && !authorRows.length) {
      return [];
    }
    if (!teamRows.length) {
      return authorRows;
    }
    if (!authorRows.length) {
      return teamRows;
    }
    const rowCount = Math.min(teamRows.length, authorRows.length);
    const rows = [];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        ...teamRows[index],
        ...authorRows[index],
      });
    }
    return rows;
  }, [teamRows, authorRows]);

  useEffect(() => {
    if (!activeTrendRows.length) {
      setActiveTrendIndex(null);
      return;
    }
    setActiveTrendIndex(activeTrendRows.length - 1);
  }, [activeTrendRows]);

  const activeMoment = useMemo(() => {
    if (!activeTrendRows.length) {
      return null;
    }
    const fallbackIndex = activeTrendRows.length - 1;
    const resolvedIndex = Number.isInteger(activeTrendIndex)
      ? Math.max(0, Math.min(fallbackIndex, activeTrendIndex))
      : fallbackIndex;
    return {
      index: resolvedIndex,
      row: activeTrendRows[resolvedIndex],
    };
  }, [activeTrendRows, activeTrendIndex]);

  const handleDialWheel = useCallback((event) => {
    if (activeTrendRows.length <= 1) {
      return;
    }
    const tagName = String(event?.target?.tagName || '').toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return;
    }
    const delta = Number(event.deltaY) || 0;
    if (delta === 0) {
      return;
    }
    const direction = delta > 0 ? 1 : -1;
    const step = Math.max(1, Math.round(Math.abs(delta) / 20));
    setActiveTrendIndex((prev) => {
      const fallbackIndex = activeTrendRows.length - 1;
      const currentIndex = Number.isInteger(prev) ? prev : fallbackIndex;
      return Math.max(0, Math.min(fallbackIndex, currentIndex + direction * step));
    });
  }, [activeTrendRows.length]);

  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams]
  );

  const activeTeamTotalSeries = useMemo(
    () => teamTotalSeries.filter((series) => activeTeamIdsInWindow.has(series.teamId)),
    [teamTotalSeries, activeTeamIdsInWindow]
  );

  const authorByKey = useMemo(
    () => Object.fromEntries(authorSeries.map((author) => [author.key, author])),
    [authorSeries]
  );

  const userRankingRows = useMemo(() => {
    const row = activeMoment?.row;
    if (!row) {
      return [];
    }
    return authorSeries
      .map((series) => {
        const signedValue = Number(row[series.key]) || 0;
        const team = teamById.get(series.teamId);
        return {
          ...series,
          teamLabel: team?.label ?? series.teamId ?? '-',
          signedValue,
          magnitude: Math.abs(signedValue),
        };
      })
      .filter((item) => item.magnitude > 0 && activeTeamIdsInWindow.has(item.teamId))
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [activeMoment, authorSeries, teamById, activeTeamIdsInWindow]);

  const teamStackRows = useMemo(() => {
    const row = activeMoment?.row;
    if (!row) {
      return [];
    }

    return activeTeamTotalSeries.map((teamSeries) => {
      const stackRow = {
        teamId: teamSeries.teamId,
        teamLabel: teamById.get(teamSeries.teamId)?.label ?? teamSeries.label,
        total: 0,
      };

      for (const author of authorSeries) {
        const value = author.teamId === teamSeries.teamId
          ? (Number(row[author.key]) || 0)
          : 0;
        stackRow[author.key] = value;
        stackRow.total += value;
      }

      return stackRow;
    });
  }, [activeMoment, activeTeamTotalSeries, authorSeries, teamById]);

  const activeTeamAuthors = useMemo(
    () => authorSeries.filter((author) => activeTeamIdsInWindow.has(author.teamId)),
    [authorSeries, activeTeamIdsInWindow]
  );

  const teamStackSeries = activeTeamAuthors;

  const teamStackDomain = useMemo(
    () => buildStackValueBounds(teamStackRows, teamStackSeries),
    [teamStackRows, teamStackSeries]
  );

  const hasNegativeTeamValue = useMemo(
    () => teamStackDomain[0] < 0,
    [teamStackDomain]
  );

  const teamStackUnitLabel = showProjectPercent
    ? '%'
    : (metricMode === 'commits' ? 'commit' : (useNetLines ? 'net line' : 'line'));
  const teamStackValueFormatter = showProjectPercent
    ? (value) => Number(value || 0).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : formatNumber;

  const teamAreaSeries = useMemo(
    () => activeTeamTotalSeries.map((series) => ({
      ...series,
      label: teamById.get(series.teamId)?.label ?? series.label,
    })),
    [activeTeamTotalSeries, teamById]
  );

  const teamAreaSeriesByKey = useMemo(
    () => Object.fromEntries(teamAreaSeries.map((series) => [series.key, series])),
    [teamAreaSeries]
  );

  const teamAreaRows = useMemo(() => {
    if (!activeTrendRows.length || !teamAreaSeries.length) {
      return [];
    }
    return activeTrendRows.map((row, index) => {
      const lineRow = {
        index,
        timestampMs: Number(row.timestampMs) || 0,
        label: formatKoreanDateTime(row.timestampMs),
        shortLabel: formatBattleMomentShort(row.timestampMs),
      };
      for (const series of teamAreaSeries) {
        lineRow[series.key] = Number(row[series.key]) || 0;
      }
      return lineRow;
    });
  }, [activeTrendRows, teamAreaSeries]);

  const teamAreaDomain = useMemo(
    () => buildSeriesValueBounds(teamAreaRows, teamAreaSeries),
    [teamAreaRows, teamAreaSeries]
  );

  const dialWindowText = useMemo(
    () => `${formatKoreanDateTime(BATTLE_TIMELINE_START_MS)} ~ ${formatKoreanDateTime(BATTLE_TIMELINE_END_MS)}`,
    []
  );

  const activeLineMarkerIndex = useMemo(
    () => (activeMoment ? Number(activeMoment.index) : null),
    [activeMoment]
  );

  const renderTeamSegmentLabel = useCallback((props, authorLabel) => {
    const rawX = Number(props?.x) || 0;
    const rawY = Number(props?.y) || 0;
    const rawWidth = Number(props?.width) || 0;
    const rawHeight = Number(props?.height) || 0;
    const safeWidth = Math.abs(rawWidth);
    const safeHeight = Math.abs(rawHeight);
    const magnitude = Math.abs(Number(props?.value) || 0);
    const baseLabel = String(authorLabel || '').trim();
    if (!baseLabel || magnitude === 0 || safeWidth < 34 || safeHeight < 14) {
      return null;
    }

    const textLabel = baseLabel.length > 10 ? `${baseLabel.slice(0, 9)}…` : baseLabel;
    const minRequiredWidth = Math.max(30, textLabel.length * 5.7);
    if (safeWidth < minRequiredWidth) {
      return null;
    }

    const leftX = rawWidth >= 0 ? rawX : rawX + rawWidth;
    const topY = rawHeight >= 0 ? rawY : rawY + rawHeight;
    const textX = leftX + (safeWidth / 2);
    const textY = topY + (safeHeight / 2) + 3;

    return (
      <text
        x={textX}
        y={textY}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill="rgba(255, 255, 255, 0.96)"
        stroke="rgba(0, 0, 0, 0.42)"
        strokeWidth={2}
        paintOrder="stroke"
        pointerEvents="none"
      >
        {textLabel}
      </text>
    );
  }, []);

  const trendTitle = `${metricMode === 'commits' ? '커밋' : '라인'} 팀+사용자 통합 추이`;

  const trendDescription = showProjectPercent
    ? `시점 다이얼 기준으로 사용자 랭킹과 팀/사용자 점유율(%)을 동시에 비교합니다. (${dialWindowText})`
    : `시점 다이얼 기준으로 사용자 랭킹, 팀별 막대 + 팀별 영역 그래프를 비교합니다. (${useNetLines ? '순변경' : '총변경'}, ${dialWindowText})`;

  if (loading || fileListLoading) {
    return (
      <div className="center-screen">
        <Loader color={actionButtonColor} size="lg" />
        <Text size="sm" c="dimmed">팀간 배틀 데이터를 불러오는 중...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="center-screen">
        <Alert variant="light" color="gray" title="오류" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      </div>
    );
  }

  return (
    <main className="battle-shell" onWheelCapture={handleDialWheel}>
      <div className="battle-scroll">
        <Card className="chart-card battle-main-card card-enter delay-2" radius="xl" p="lg" withBorder>
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Stack gap="xs">
              <Title order={4}>{trendTitle}</Title>
              <Text size="sm" c="dimmed">{trendDescription}</Text>
            </Stack>
            <Group gap="xs">
              <Button
                size="xs"
                color={actionButtonColor}
                radius={0}
                variant={metricMode === 'commits' ? 'filled' : 'default'}
                onClick={() => setMetricMode('commits')}
              >
                커밋 수
              </Button>
              <Button
                size="xs"
                color={actionButtonColor}
                radius={0}
                variant={metricMode === 'lines' ? 'filled' : 'default'}
                onClick={() => setMetricMode('lines')}
              >
                라인 수
              </Button>
            </Group>
          </Group>

          <div className="battle-option-slot">
            <Group gap="xs" wrap="nowrap" className="stack-chart-option-group">
              <Group gap={6} wrap="nowrap">
                <Checkbox
                  size="sm"
                  color={actionButtonColor}
                  radius={0}
                  checked={excludeTopLongCommits}
                  onChange={(event) => setExcludeTopLongCommits(event.currentTarget.checked)}
                  label="긴 커밋 제외(상위"
                />
                <NumberInput
                  size="xs"
                  w={52}
                  min={0}
                  max={100}
                  step={1}
                  hideControls
                  placeholder="0"
                  value={topLongCommitPercentInput}
                  onChange={(value) => setTopLongCommitPercentInput(toNumericInputValue(value))}
                  styles={{
                    input: {
                      height: 24,
                      minHeight: 24,
                      paddingTop: 0,
                      paddingBottom: 0,
                      textAlign: 'center',
                    },
                  }}
                />
                <Text size="sm">%)</Text>
              </Group>
              <Checkbox
                size="sm"
                color={actionButtonColor}
                radius={0}
                checked={linkedMetricOptionChecked}
                onChange={(event) => setLinkedMetricOptionChecked(event.currentTarget.checked)}
                label={metricMode === 'commits' ? '0줄 변경 커밋 제외' : '순변경으로 계산(+/-)'}
              />
            </Group>
          </div>

          {identityRules.invalidLines.length > 0 && (
            <Text size="xs" c="dimmed" mt="xs">
              병합 규칙 {identityRules.invalidLines.length}개 줄은 형식 오류로 무시되었습니다.
            </Text>
          )}
          {identityRuleError && (
            <Alert variant="light" color="gray" icon={<IconAlertCircle size={14} />} mt="sm">
              작성자 병합 규칙 로드 실패: {identityRuleError}
            </Alert>
          )}

          <Paper
            withBorder
            radius="md"
            p="sm"
            className="battle-dial-panel"
          >
            <Group justify="space-between" align="center" mb={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>시점 다이얼</Text>
              <Text size="xs" c="dimmed">
                {activeMoment?.row ? formatKoreanDateTime(activeMoment.row.timestampMs) : '-'}
              </Text>
            </Group>
            <Slider
              min={0}
              max={Math.max(0, activeTrendRows.length - 1)}
              step={1}
              value={activeTrendIndex ?? Math.max(0, activeTrendRows.length - 1)}
              onChange={setActiveTrendIndex}
              disabled={activeTrendRows.length <= 1}
              color={actionButtonColor}
              label={null}
            />
            <Text size="xs" c="dimmed" mt={6}>
              다이얼 범위: {dialWindowText} (휠 스크롤 가능)
            </Text>
          </Paper>

          <div className="battle-chart-layout">
            <Paper withBorder radius="md" p="sm" className="battle-ranking-panel">
              <Group justify="space-between" align="center" mb={8}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>사용자 랭킹</Text>
                <Badge color="gray" variant="light">{userRankingRows.length}명</Badge>
              </Group>
              <div className="battle-ranking-list">
                {userRankingRows.map((user, index) => (
                  <div key={`ranking-${user.key}`} className="battle-ranking-item">
                    <Text size="xs" fw={700} c="dimmed" className="battle-ranking-order">
                      {index + 1}
                    </Text>
                    <div className="battle-ranking-main">
                      <Text size="sm" fw={700} className="battle-ranking-name" style={{ color: user.stroke }}>
                        {user.label}
                      </Text>
                      <Text size="xs" c="dimmed">{user.teamLabel}</Text>
                    </div>
                    <Text size="sm" fw={700}>
                      {showProjectPercent
                        ? `${Number(user.signedValue).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                        : formatNumber(user.signedValue)}
                    </Text>
                  </div>
                ))}
              </div>
            </Paper>

            <Paper withBorder radius="md" p="sm" className="battle-rect-panel">
              <Group justify="space-between" align="center" mb={8}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>팀 막대/꺾은선 그래프</Text>
                <Badge color="gray" variant="light">{activeTeamTotalSeries.length}개 팀</Badge>
              </Group>
              {activeTeamTotalSeries.length === 0 ? (
                <Text size="sm" c="dimmed">
                  지정된 시점 범위(2026-02-21 15:00 ~ 2026-02-22 09:00)에 커밋이 있는 팀이 없습니다.
                </Text>
              ) : (
                <div className="battle-team-visual-layout">
                  <div className="battle-team-chart-block">
                    <Text size="xs" c="dimmed" fw={700} mb={4}>스택 막대</Text>
                    <div className="battle-team-bar-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={teamStackRows}
                          stackOffset="sign"
                          margin={{ top: 8, right: 10, left: 0, bottom: 2 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                          <XAxis
                            dataKey="teamLabel"
                            interval={0}
                            height={teamStackRows.length > 6 ? 44 : 26}
                            angle={teamStackRows.length > 6 ? -18 : 0}
                            textAnchor={teamStackRows.length > 6 ? 'end' : 'middle'}
                            tick={{ fill: chartTickColor, fontSize: 11 }}
                            axisLine={{ stroke: chartAxisStroke }}
                            tickLine={{ stroke: chartAxisStroke }}
                          />
                          <YAxis
                            allowDecimals={showProjectPercent}
                            domain={teamStackDomain}
                            tickFormatter={
                              showProjectPercent
                                ? (value) => `${Math.round(Number(value) || 0)}%`
                                : undefined
                            }
                            tick={{ fill: chartTickColor, fontSize: 11 }}
                            axisLine={{ stroke: chartAxisStroke }}
                            tickLine={{ stroke: chartAxisStroke }}
                          />
                          {(useNetLines || hasNegativeTeamValue) && (
                            <ReferenceLine y={0} stroke={chartReferenceStroke} strokeDasharray="4 4" />
                          )}
                          <Tooltip
                            content={
                              <TeamStackedTooltip
                                authorByKey={authorByKey}
                                unitLabel={teamStackUnitLabel}
                                valueFormatter={teamStackValueFormatter}
                              />
                            }
                          />
                          {teamStackSeries.map((author) => (
                            <Bar
                              key={`team-stack-${author.key}`}
                              dataKey={author.key}
                              stackId={metricMode}
                              fill={author.stroke}
                              isAnimationActive={false}
                            >
                              <LabelList
                                dataKey={author.key}
                                content={(props) => renderTeamSegmentLabel(props, author.label)}
                              />
                              {teamStackRows.map((row, index) => (
                                <Cell
                                  key={`${author.key}-${row?.teamId ?? index}`}
                                  radius={[4, 4, 4, 4]}
                                />
                              ))}
                            </Bar>
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="battle-team-chart-block">
                    <Text size="xs" c="dimmed" fw={700} mb={4}>팀 추이 영역</Text>
                    {teamAreaSeries.length === 0 ? (
                      <Text size="sm" c="dimmed">해당 시점의 팀 데이터가 없습니다.</Text>
                    ) : (
                      <div className="battle-team-line-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={teamAreaRows}
                            stackOffset="sign"
                            margin={{ top: 8, right: 10, left: 0, bottom: 2 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                            <XAxis
                              dataKey="index"
                              interval="preserveStartEnd"
                              tickFormatter={(value) => teamAreaRows[value]?.shortLabel ?? ''}
                              minTickGap={18}
                              tick={{ fill: chartTickColor, fontSize: 11 }}
                              axisLine={{ stroke: chartAxisStroke }}
                              tickLine={{ stroke: chartAxisStroke }}
                            />
                            <YAxis
                              allowDecimals={showProjectPercent}
                              domain={teamAreaDomain}
                              tickFormatter={
                                showProjectPercent
                                  ? (value) => `${Math.round(Number(value) || 0)}%`
                                  : undefined
                              }
                              tick={{ fill: chartTickColor, fontSize: 11 }}
                              axisLine={{ stroke: chartAxisStroke }}
                              tickLine={{ stroke: chartAxisStroke }}
                            />
                            {Number.isFinite(activeLineMarkerIndex) && (
                              <ReferenceLine x={activeLineMarkerIndex} stroke={chartReferenceStroke} strokeWidth={1.6} />
                            )}
                            {(useNetLines || teamAreaDomain[0] < 0) && (
                              <ReferenceLine y={0} stroke={chartReferenceStroke} strokeDasharray="4 4" />
                            )}
                            <Tooltip
                              content={
                                <TeamLineTooltip
                                  seriesByKey={teamAreaSeriesByKey}
                                  valueFormatter={teamStackValueFormatter}
                                  showPercent={showProjectPercent}
                                />
                              }
                            />
                            {teamAreaSeries.map((series) => (
                              <Area
                                key={`team-area-${series.teamId}`}
                                type="monotone"
                                dataKey={series.key}
                                stackId={`team-area-${metricMode}`}
                                stroke={series.stroke}
                                fill={withAlpha(series.stroke, 0.26)}
                                strokeWidth={1.6}
                                fillOpacity={1}
                                dot={false}
                                activeDot={false}
                                isAnimationActive={false}
                              />
                            ))}
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Paper>
          </div>
        </Card>
      </div>
    </main>
  );
}
