import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
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
const REPO_BATTLE_SERIES = [
  {
    id: 'backend',
    key: 'repo_group_backend',
    label: '백엔드',
    stroke: '#dc2626',
  },
  {
    id: 'frontend',
    key: 'repo_group_frontend',
    label: '프런트',
    stroke: '#1d4ed8',
  },
];
const DEFAULT_REPO_LINE_LIMIT = 8;
const RIGHT_CHART_MODE_OPTIONS = [
  { value: 'repo_rank', label: '레포 순위' },
  { value: 'repo_battle', label: '프런트 vs 백엔드' },
];
const DEFAULT_REMOVED_TEAM_IDS = [teamIdFromFileName('유자잼.json')];

function resolveAppAssetUrl(relativePath) {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return `${normalizedBase}${normalizedPath}`;
}

function resolveAppRouteUrl(relativePath = '') {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return normalizedPath ? `${normalizedBase}${normalizedPath}` : normalizedBase;
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
      repoSeries: [],
      repoKeyById: new Map(),
    };
  }

  const teamOrder = [];
  const teamById = new Map();
  const nodes = [];
  const authorStatsById = new Map();
  const repoStatsById = new Map();

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
        repoName: String(node.projectId || ''),
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

      if (!repoStatsById.has(transformed.repoId)) {
        repoStatsById.set(transformed.repoId, {
          id: transformed.repoId,
          teamId: transformed.teamId,
          repoName: transformed.repoName || 'unknown-repo',
          commits: 0,
          lines: 0,
        });
      }
      const repoStats = repoStatsById.get(transformed.repoId);
      repoStats.commits += 1;
      repoStats.lines += transformed.touchedLines;
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

  const sortedRepos = [...repoStatsById.values()]
    .sort((a, b) => (
      b.commits - a.commits
      || b.lines - a.lines
      || a.repoName.localeCompare(b.repoName)
      || a.id.localeCompare(b.id)
    ));

  const repoColorOrderByTeam = new Map();
  const repoSeries = sortedRepos.map((repo, index) => {
    const orderInTeam = repoColorOrderByTeam.get(repo.teamId) ?? 0;
    repoColorOrderByTeam.set(repo.teamId, orderInTeam + 1);
    const teamColor = teamColorById.get(repo.teamId) ?? '#64748b';

    return {
      id: repo.id,
      key: `repo_${index}`,
      teamId: repo.teamId,
      label: repo.repoName || 'unknown-repo',
      stroke: pickUserStrokeByTeam(teamColor, orderInTeam),
      strokeWidth: 1.1,
      opacity: 0.95,
      isTeamTotal: false,
    };
  });

  const repoKeyById = new Map(repoSeries.map((repo) => [repo.id, repo.key]));

  return {
    nodes,
    teams,
    teamTotalSeries,
    authorSeries,
    authorKeyById,
    repoSeries,
    repoKeyById,
  };
}

function classifyRepoBattleGroup(repoName = '') {
  const normalized = String(repoName || '').toLowerCase();
  if (normalized.includes('server') || normalized.includes('back')) {
    return 'backend';
  }
  if (
    normalized.includes('front')
    || normalized.includes('mobile')
    || normalized.includes('pc')
  ) {
    return 'frontend';
  }
  return null;
}

function buildBattleRowsBundle({
  timelineWindowNodes,
  preTimelineNodes,
  includePreTimelinePrep = false,
  teamTotalSeries,
  authorSeries,
  authorKeyById,
  repoSeries,
  repoKeyById,
  metric,
  subtractDeletions = false,
  showPercent = false,
  excludedCommitIds = null,
  needAuthorRows = true,
  needRepoRows = true,
  needRepoBattleRows = true,
}) {
  const teamRows = [];
  const authorRows = [];
  const repoRows = [];
  const repoBattleRows = [];
  const activeTeamIds = new Set();

  if (!Array.isArray(timelineWindowNodes) || timelineWindowNodes.length === 0) {
    return {
      teamRows,
      authorRows,
      repoRows,
      repoBattleRows,
      activeTeamIds,
    };
  }

  const teamTotalsById = Object.fromEntries(teamTotalSeries.map((series) => [series.id, 0]));
  const authorTotalsByKey = needAuthorRows
    ? Object.fromEntries(authorSeries.map((series) => [series.key, 0]))
    : null;
  const repoTotalsByKey = needRepoRows
    ? Object.fromEntries(repoSeries.map((series) => [series.key, 0]))
    : null;
  const repoBattleTotalsById = needRepoBattleRows
    ? Object.fromEntries(REPO_BATTLE_SERIES.map((series) => [series.id, 0]))
    : null;

  const applyNodeDelta = (node) => {
    if (excludedCommitIds?.has(node.id)) {
      return;
    }

    const delta = trendDelta(node, metric, subtractDeletions);
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(teamTotalsById, node.teamId)) {
      teamTotalsById[node.teamId] += delta;
    }

    if (authorTotalsByKey) {
      const authorKey = authorKeyById.get(node.authorId);
      if (authorKey && Object.prototype.hasOwnProperty.call(authorTotalsByKey, authorKey)) {
        authorTotalsByKey[authorKey] += delta;
      }
    }

    if (repoTotalsByKey) {
      const repoKey = repoKeyById.get(node.repoId);
      if (repoKey && Object.prototype.hasOwnProperty.call(repoTotalsByKey, repoKey)) {
        repoTotalsByKey[repoKey] += delta;
      }
    }

    if (repoBattleTotalsById) {
      const groupId = classifyRepoBattleGroup(node.repoName);
      if (groupId && Object.prototype.hasOwnProperty.call(repoBattleTotalsById, groupId)) {
        repoBattleTotalsById[groupId] += delta;
      }
    }
  };

  if (includePreTimelinePrep && Array.isArray(preTimelineNodes) && preTimelineNodes.length > 0) {
    for (const node of preTimelineNodes) {
      applyNodeDelta(node);
    }
  }

  for (let index = 0; index < timelineWindowNodes.length; index += 1) {
    const node = timelineWindowNodes[index];
    applyNodeDelta(node);

    const rowBase = {
      index,
      timestampMs: Number(node.timestampMs) || 0,
      label: formatKoreanDateTime(node.timestampMs),
      shortLabel: formatBattleMomentShort(node.timestampMs),
    };

    const teamRow = { ...rowBase };
    if (!showPercent) {
      for (const series of teamTotalSeries) {
        const value = Number(teamTotalsById[series.id]) || 0;
        teamRow[series.key] = value;
        if (Math.abs(value) > 0) {
          activeTeamIds.add(series.id);
        }
      }
    } else {
      const teamDenominator = teamTotalSeries.reduce(
        (sum, series) => sum + Math.abs(Number(teamTotalsById[series.id]) || 0),
        0
      );
      for (const series of teamTotalSeries) {
        const value = Number(teamTotalsById[series.id]) || 0;
        const percentValue = teamDenominator > 0 ? (value / teamDenominator) * 100 : 0;
        teamRow[series.key] = percentValue;
        if (Math.abs(percentValue) > 0) {
          activeTeamIds.add(series.id);
        }
      }
    }
    teamRows.push(teamRow);

    if (authorTotalsByKey) {
      const authorRow = { ...rowBase };
      if (!showPercent) {
        for (const series of authorSeries) {
          authorRow[series.key] = Number(authorTotalsByKey[series.key]) || 0;
        }
      } else {
        const authorDenominator = authorSeries.reduce(
          (sum, series) => sum + Math.abs(Number(authorTotalsByKey[series.key]) || 0),
          0
        );
        for (const series of authorSeries) {
          const value = Number(authorTotalsByKey[series.key]) || 0;
          authorRow[series.key] = authorDenominator > 0 ? (value / authorDenominator) * 100 : 0;
        }
      }
      authorRows.push(authorRow);
    }

    if (repoTotalsByKey) {
      const repoRow = { ...rowBase };
      if (!showPercent) {
        for (const series of repoSeries) {
          repoRow[series.key] = Number(repoTotalsByKey[series.key]) || 0;
        }
      } else {
        const repoDenominator = repoSeries.reduce(
          (sum, series) => sum + Math.abs(Number(repoTotalsByKey[series.key]) || 0),
          0
        );
        for (const series of repoSeries) {
          const value = Number(repoTotalsByKey[series.key]) || 0;
          repoRow[series.key] = repoDenominator > 0 ? (value / repoDenominator) * 100 : 0;
        }
      }
      repoRows.push(repoRow);
    }

    if (repoBattleTotalsById) {
      const repoBattleRow = { ...rowBase };
      for (const series of REPO_BATTLE_SERIES) {
        repoBattleRow[series.key] = Number(repoBattleTotalsById[series.id]) || 0;
      }
      repoBattleRows.push(repoBattleRow);
    }
  }

  return {
    teamRows,
    authorRows,
    repoRows,
    repoBattleRows,
    activeTeamIds,
  };
}

function toNumericInputValue(rawValue) {
  if (rawValue === '' || rawValue === null || rawValue === undefined) {
    return '';
  }
  return String(rawValue);
}

function parseRepoRankLineInput(rawValue) {
  const source = String(rawValue ?? '').trim();
  if (!source) {
    return null;
  }

  const matched = /^([+-])?\s*(\d+)$/u.exec(source);
  if (!matched) {
    return null;
  }

  const sign = matched[1] === '-' ? -1 : 1;
  const parsedCount = Number.parseInt(matched[2], 10);
  if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
    return null;
  }

  const count = Math.max(1, Math.min(999, parsedCount));
  const direction = sign < 0 ? 'bottom' : 'top';
  return {
    direction,
    count,
    normalized: `${direction === 'bottom' ? '-' : '+'}${count}`,
  };
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
  seriesByKey,
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
          const series = seriesByKey[item.dataKey];
          return (
            <Group key={`${item.dataKey}-${label}`} justify="space-between" gap="xl">
              <Group gap={8}>
                <span
                  className="swatch"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <Text size="sm">{series?.label ?? item.dataKey}</Text>
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

function SeriesLegendBoxes({ series = [] }) {
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }

  return (
    <div className="battle-series-legend">
      {series.map((item) => (
        <div key={`legend-${item.key}`} className="battle-series-box">
          <span className="swatch" style={{ backgroundColor: item.stroke }} aria-hidden="true" />
          <Text size="xs" fw={700}>{item.label}</Text>
        </div>
      ))}
    </div>
  );
}

export default function TeamBattleView({
  colorScheme = 'light',
  onToggleColorScheme = () => {},
}) {
  const [teamPayloads, setTeamPayloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fileListLoading, setFileListLoading] = useState(true);
  const [error, setError] = useState('');
  const [identityRuleError, setIdentityRuleError] = useState('');
  const [identityRulesText, setIdentityRulesText] = useState(
    () => readStoredIdentityRulesText() || DEFAULT_IDENTITY_RULES_TEXT
  );
  const [logFiles, setLogFiles] = useState([]);
  const [isTeamFilterModalOpen, setIsTeamFilterModalOpen] = useState(false);
  const [removedTeamIds, setRemovedTeamIds] = useState(DEFAULT_REMOVED_TEAM_IDS);

  const [entityMode, setEntityMode] = useState('repo');
  const [rightChartMode, setRightChartMode] = useState('repo_rank');
  const [repoRankLineInput, setRepoRankLineInput] = useState(`+${DEFAULT_REPO_LINE_LIMIT}`);
  const [metricMode, setMetricMode] = useState('commits');
  const showProjectPercent = false;
  const [includePreTimelinePrep, setIncludePreTimelinePrep] = useState(false);
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

  const isDarkMode = colorScheme === 'dark';
  const actionButtonColor = isDarkMode ? 'gray' : 'dark';
  const teamReviewUrl = resolveAppRouteUrl('');
  const chartGridStroke = colorScheme === 'dark' ? 'rgba(181, 197, 227, 0.25)' : 'rgba(24, 24, 24, 0.14)';
  const chartReferenceStroke = colorScheme === 'dark' ? 'rgba(218, 228, 248, 0.6)' : 'rgba(24, 24, 24, 0.45)';
  const chartTickColor = colorScheme === 'dark' ? '#c0cbdf' : '#575757';
  const chartAxisStroke = colorScheme === 'dark' ? '#7b879f' : '#9b9b9b';
  const teamFilterOptions = useMemo(() => {
    const seenTeamIds = new Set();
    const options = [];
    for (const file of logFiles) {
      const teamId = teamIdFromFileName(file.name);
      if (seenTeamIds.has(teamId)) {
        continue;
      }
      seenTeamIds.add(teamId);
      options.push({
        id: teamId,
        label: teamId,
        fileName: file.name,
      });
    }
    return options;
  }, [logFiles]);

  const removedTeamIdSet = useMemo(() => new Set(removedTeamIds), [removedTeamIds]);

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
    if (!teamFilterOptions.length) {
      return;
    }

    const availableTeamIds = new Set(teamFilterOptions.map((item) => item.id));
    setRemovedTeamIds((prev) => {
      const next = prev.filter((id) => availableTeamIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [teamFilterOptions]);

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

  const activeTeamPayloads = useMemo(() => {
    if (!removedTeamIdSet.size) {
      return teamPayloads;
    }
    return teamPayloads.filter(
      (teamPayload) => !removedTeamIdSet.has(teamIdFromFileName(teamPayload.fileName))
    );
  }, [teamPayloads, removedTeamIdSet]);

  const prepared = useMemo(
    () => buildPreparedTeamBattle(activeTeamPayloads, identityRules.pairs),
    [activeTeamPayloads, identityRules]
  );

  const nodes = prepared.nodes;
  const teamTotalSeries = prepared.teamTotalSeries;
  const authorSeries = prepared.authorSeries;
  const authorKeyById = prepared.authorKeyById;
  const repoSeries = prepared.repoSeries;
  const repoKeyById = prepared.repoKeyById;
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

  const metricForTrend = metricMode === 'commits' ? 'commits' : 'code';
  const useNetLines = metricMode === 'lines' && subtractDeletions;

  const timelineWindowNodes = useMemo(
    () => nodes.filter((node) => {
      const timestampMs = Number(node.timestampMs) || 0;
      return timestampMs >= BATTLE_TIMELINE_START_MS && timestampMs <= BATTLE_TIMELINE_END_MS;
    }),
    [nodes]
  );

  const preTimelineNodes = useMemo(
    () => nodes.filter((node) => (Number(node.timestampMs) || 0) < BATTLE_TIMELINE_START_MS),
    [nodes]
  );

  const needAuthorRows = entityMode === 'user';
  const needRepoRows = entityMode === 'repo' || rightChartMode === 'repo_rank';
  const needRepoBattleRows = rightChartMode === 'repo_battle';

  const battleRowsBundle = useMemo(
    () => buildBattleRowsBundle({
      timelineWindowNodes,
      preTimelineNodes,
      includePreTimelinePrep,
      teamTotalSeries,
      authorSeries,
      authorKeyById,
      repoSeries,
      repoKeyById,
      metric: metricForTrend,
      subtractDeletions: useNetLines,
      showPercent: showProjectPercent,
      excludedCommitIds: activeExcludedCommitIds,
      needAuthorRows,
      needRepoRows,
      needRepoBattleRows,
    }),
    [
      timelineWindowNodes,
      preTimelineNodes,
      includePreTimelinePrep,
      teamTotalSeries,
      authorSeries,
      authorKeyById,
      repoSeries,
      repoKeyById,
      metricForTrend,
      useNetLines,
      showProjectPercent,
      activeExcludedCommitIds,
      needAuthorRows,
      needRepoRows,
      needRepoBattleRows,
    ]
  );

  const teamRows = battleRowsBundle.teamRows;
  const authorRows = battleRowsBundle.authorRows;
  const repoRows = battleRowsBundle.repoRows;
  const repoBattleRows = battleRowsBundle.repoBattleRows;
  const activeTeamIds = battleRowsBundle.activeTeamIds;
  const timelineRows = teamRows;

  useEffect(() => {
    if (!timelineRows.length) {
      setActiveTrendIndex(null);
      return;
    }
    setActiveTrendIndex((prev) => {
      const fallbackIndex = timelineRows.length - 1;
      if (!Number.isInteger(prev)) {
        return fallbackIndex;
      }
      return Math.max(0, Math.min(fallbackIndex, prev));
    });
  }, [timelineRows.length]);

  const activeMoment = useMemo(() => {
    if (!timelineRows.length) {
      return null;
    }
    const fallbackIndex = timelineRows.length - 1;
    const resolvedIndex = Number.isInteger(activeTrendIndex)
      ? Math.max(0, Math.min(fallbackIndex, activeTrendIndex))
      : fallbackIndex;
    const row = timelineRows[resolvedIndex];
    return {
      index: resolvedIndex,
      timestampMs: Number(row?.timestampMs) || 0,
    };
  }, [timelineRows, activeTrendIndex]);

  const handleDialWheel = useCallback((event) => {
    if (timelineRows.length <= 1) {
      return;
    }
    const targetElement = event?.target;
    if (
      typeof Element !== 'undefined'
      && targetElement instanceof Element
      && targetElement.closest('.battle-ranking-panel')
    ) {
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
      const fallbackIndex = timelineRows.length - 1;
      const currentIndex = Number.isInteger(prev) ? prev : fallbackIndex;
      return Math.max(0, Math.min(fallbackIndex, currentIndex + direction * step));
    });
  }, [timelineRows.length]);

  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams]
  );

  const activeTeamTotalSeries = useMemo(
    () => teamTotalSeries.filter((series) => activeTeamIds.has(series.teamId)),
    [teamTotalSeries, activeTeamIds]
  );

  const rankingEntitySeries = useMemo(
    () => (entityMode === 'repo' ? repoSeries : authorSeries),
    [entityMode, repoSeries, authorSeries]
  );

  const rankingTeamEntitySeries = useMemo(
    () => rankingEntitySeries.filter((entity) => activeTeamIds.has(entity.teamId)),
    [rankingEntitySeries, activeTeamIds]
  );

  const rightChartTeamEntitySeries = rankingTeamEntitySeries;

  const rightChartEntityByKey = useMemo(
    () => Object.fromEntries(rightChartTeamEntitySeries.map((entity) => [entity.key, entity])),
    [rightChartTeamEntitySeries]
  );

  const activeRankingRow = useMemo(() => {
    if (!activeMoment) {
      return null;
    }
    const rowIndex = Number(activeMoment.index) || 0;
    if (entityMode === 'repo') {
      return repoRows[rowIndex] ?? null;
    }
    return authorRows[rowIndex] ?? null;
  }, [activeMoment, entityMode, repoRows, authorRows]);

  const rankingRows = useMemo(() => {
    const row = activeRankingRow;
    if (!row) {
      return [];
    }
    return rankingTeamEntitySeries
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
      .filter((item) => item.magnitude > 0)
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [activeRankingRow, rankingTeamEntitySeries, teamById]);

  const teamStackRows = useMemo(() => {
    const row = activeRankingRow;
    if (!row) {
      return [];
    }

    return activeTeamTotalSeries.map((teamSeries) => {
      const stackRow = {
        teamId: teamSeries.teamId,
        teamLabel: teamById.get(teamSeries.teamId)?.label ?? teamSeries.label,
        total: 0,
      };

      for (const entity of rightChartTeamEntitySeries) {
        const value = entity.teamId === teamSeries.teamId
          ? (Number(row[entity.key]) || 0)
          : 0;
        stackRow[entity.key] = value;
        stackRow.total += value;
      }

      return stackRow;
    });
  }, [activeRankingRow, activeTeamTotalSeries, rightChartTeamEntitySeries, teamById]);

  const teamStackSeries = rightChartTeamEntitySeries;

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

  const repoBattleSeriesByKey = useMemo(
    () => Object.fromEntries(REPO_BATTLE_SERIES.map((series) => [series.key, series])),
    []
  );

  const repoBattleDomain = useMemo(
    () => buildSeriesValueBounds(repoBattleRows, REPO_BATTLE_SERIES),
    [repoBattleRows]
  );

  const repoRankMagnitudeSeries = useMemo(() => {
    if (!repoRows.length) {
      return [];
    }
    const lastRow = repoRows[repoRows.length - 1];
    return repoSeries
      .map((series) => ({
        ...series,
        magnitude: Math.abs(Number(lastRow?.[series.key]) || 0),
      }))
      .filter((series) => series.magnitude > 0 && activeTeamIds.has(series.teamId))
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [repoRows, repoSeries, activeTeamIds]);

  const repoRankLineConfig = useMemo(
    () => parseRepoRankLineInput(repoRankLineInput),
    [repoRankLineInput]
  );

  const repoRankLineDirection = repoRankLineConfig?.direction ?? 'top';
  const repoRankLineCount = repoRankLineConfig?.count ?? DEFAULT_REPO_LINE_LIMIT;
  const isRepoRankLineInputValid = Boolean(repoRankLineConfig);

  const repoRankLineSeries = useMemo(() => {
    if (repoRankLineDirection === 'bottom') {
      return [...repoRankMagnitudeSeries]
        .sort((a, b) => a.magnitude - b.magnitude || a.label.localeCompare(b.label))
        .slice(0, repoRankLineCount);
    }
    return repoRankMagnitudeSeries.slice(0, repoRankLineCount);
  }, [repoRankMagnitudeSeries, repoRankLineDirection, repoRankLineCount]);

  const repoRankLineSeriesByKey = useMemo(
    () => Object.fromEntries(repoRankLineSeries.map((series) => [series.key, series])),
    [repoRankLineSeries]
  );

  const isRepoBattleMode = rightChartMode === 'repo_battle';
  const isRepoRankMode = rightChartMode === 'repo_rank';
  const repoRankStackRows = useMemo(() => {
    if (!repoRows.length || !repoRankLineSeries.length) {
      return [];
    }

    return repoRows.map((row) => {
      const nextRow = { ...row };
      const denominator = repoRankLineSeries.reduce(
        (sum, series) => sum + Math.abs(Number(row?.[series.key]) || 0),
        0
      );

      for (const series of repoRankLineSeries) {
        const rawValue = Math.abs(Number(row?.[series.key]) || 0);
        nextRow[series.key] = denominator > 0 ? (rawValue / denominator) * 100 : 0;
      }
      return nextRow;
    });
  }, [repoRows, repoRankLineSeries]);

  const repoRankLineToken = `${repoRankLineDirection === 'bottom' ? '-' : '+'}${repoRankLineCount}`;
  const repoRankLineTitle = `${repoRankLineToken} 레포 누적 점유율`;
  const repoRankLineHint = isRepoRankLineInputValid
    ? `${repoRankLineToken} 기준 ${Math.min(repoRankLineCount, repoRankLineSeries.length)}개 레포 점유율 누적(합계 100%)`
    : `입력 형식: +숫자 또는 -숫자 (예: +8, -8). 기본 +${DEFAULT_REPO_LINE_LIMIT} 적용`;

  const lineChartRows = isRepoBattleMode ? repoBattleRows : repoRankStackRows;
  const lineChartSeries = isRepoBattleMode ? REPO_BATTLE_SERIES : repoRankLineSeries;
  const lineChartSeriesByKey = isRepoBattleMode ? repoBattleSeriesByKey : repoRankLineSeriesByKey;
  const lineChartDomain = isRepoBattleMode ? repoBattleDomain : [0, 100];
  const lineChartYAxisTickFormatter = isRepoBattleMode
    ? undefined
    : (value) => `${Math.round(Number(value) || 0)}%`;
  const lineChartValueFormatter = formatNumber;
  const lineChartTitle = isRepoBattleMode
    ? '프런트 vs 백엔드 누적 추이'
    : repoRankLineTitle;
  const lineChartHint = isRepoBattleMode
    ? '레포명을 기준으로 프런트/백엔드로 분류한 누적 추이'
    : repoRankLineHint;
  const lineChartEmptyText = isRepoBattleMode
    ? '프런트/백엔드 분류 레포 데이터가 없습니다.'
    : '해당 시점의 레포 데이터가 없습니다.';
  const hasLineChartData = lineChartRows.length > 0 && lineChartSeries.length > 0;
  const hasNegativeLineValue = isRepoBattleMode && lineChartDomain[0] < 0;

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

  const trendTargetLabel = entityMode === 'repo' ? '레포' : '사용자';
  const rightChartTargetLabel = isRepoBattleMode ? '프런트 vs 백엔드' : '레포 순위';
  const trendTitle = `${metricMode === 'commits' ? '커밋' : '라인'} ${trendTargetLabel} 기준 배틀 추이`;

  const trendDescription = showProjectPercent
    ? `시점 다이얼 기준으로 ${trendTargetLabel} 랭킹과 우측 그래프(${rightChartTargetLabel})를 동시에 비교합니다.`
    : `시점 다이얼 기준으로 ${trendTargetLabel} 랭킹과 우측 그래프(${rightChartTargetLabel})를 비교합니다.`;

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
            <Group gap="xs" className="battle-control-group">
              <Group gap={6} wrap="nowrap">
                <Button
                  size="xs"
                  color={actionButtonColor}
                  radius={0}
                  variant="default"
                  component="a"
                  href={teamReviewUrl}
                >
                  팀 리뷰
                </Button>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Button
                  size="xs"
                  color={actionButtonColor}
                  radius={0}
                  variant="default"
                  onClick={onToggleColorScheme}
                  leftSection={isDarkMode ? <IconSun size={14} /> : <IconMoon size={14} />}
                >
                  {isDarkMode ? '라이트 모드' : '다크 모드'}
                </Button>
                <SegmentedControl
                  className="ios-segmented"
                  size="xs"
                  radius="xl"
                  value={entityMode}
                  onChange={(value) => setEntityMode(value === 'user' ? 'user' : 'repo')}
                  data={[
                    { value: 'user', label: '사용자' },
                    { value: 'repo', label: '레포' },
                  ]}
                />
              </Group>
              <Group gap={6} wrap="nowrap">
                <SegmentedControl
                  className="ios-segmented"
                  size="xs"
                  radius="xl"
                  value={metricMode}
                  onChange={(value) => setMetricMode(value === 'lines' ? 'lines' : 'commits')}
                  data={[
                    { value: 'commits', label: '커밋 수' },
                    { value: 'lines', label: '라인 수' },
                  ]}
                />
              </Group>
              <Group gap={6} wrap="nowrap">
                <Button
                  size="xs"
                  color={actionButtonColor}
                  radius={0}
                  variant={removedTeamIds.length > 0 ? 'filled' : 'default'}
                  onClick={() => setIsTeamFilterModalOpen(true)}
                  disabled={teamFilterOptions.length === 0}
                >
                  팀 제거 목록
                </Button>
                {removedTeamIds.length > 0 && (
                  <Badge color="gray" variant="light">{removedTeamIds.length}개 제외</Badge>
                )}
              </Group>
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
              <Checkbox
                size="sm"
                color={actionButtonColor}
                radius={0}
                checked={includePreTimelinePrep}
                onChange={(event) => setIncludePreTimelinePrep(event.currentTarget.checked)}
                label="오후 3시 이전 준비물 포함"
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
                {activeMoment ? formatKoreanDateTime(activeMoment.timestampMs) : '-'}
              </Text>
            </Group>
            <Slider
              min={0}
              max={Math.max(0, timelineRows.length - 1)}
              step={1}
              value={activeTrendIndex ?? Math.max(0, timelineRows.length - 1)}
              onChange={setActiveTrendIndex}
              disabled={timelineRows.length <= 1}
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
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  {entityMode === 'repo' ? '레포 랭킹' : '사용자 랭킹'}
                </Text>
                <Badge color="gray" variant="light">{rankingRows.length}{entityMode === 'repo' ? '개' : '명'}</Badge>
              </Group>
              <div className="battle-ranking-list">
                {rankingRows.map((item, index) => (
                  <div key={`ranking-${item.key}`} className="battle-ranking-item">
                    <Text size="xs" fw={700} c="dimmed" className="battle-ranking-order">
                      {index + 1}
                    </Text>
                    <div className="battle-ranking-main">
                      <Text size="sm" fw={700} className="battle-ranking-name" style={{ color: item.stroke }}>
                        {item.label}
                      </Text>
                      <Text size="xs" c="dimmed">{item.teamLabel}</Text>
                    </div>
                    <Text size="sm" fw={700}>
                      {showProjectPercent
                        ? `${Number(item.signedValue).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                        : formatNumber(item.signedValue)}
                    </Text>
                  </div>
                ))}
              </div>
            </Paper>

            <Paper withBorder radius="md" p="sm" className="battle-rect-panel">
              <Group justify="space-between" align="center" mb={8}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>팀 막대/꺾은선 그래프</Text>
                <Group gap={8} wrap="nowrap">
                  <Select
                    size="xs"
                    w={180}
                    data={RIGHT_CHART_MODE_OPTIONS}
                    value={rightChartMode}
                    onChange={(value) => setRightChartMode(value === 'repo_battle' ? 'repo_battle' : 'repo_rank')}
                    allowDeselect={false}
                    aria-label="우측 그래프 기준"
                  />
                  {rightChartMode === 'repo_rank' && (
                    <TextInput
                      size="xs"
                      w={122}
                      value={repoRankLineInput}
                      onChange={(event) => setRepoRankLineInput(event.currentTarget.value)}
                      onBlur={() => {
                        const parsed = parseRepoRankLineInput(repoRankLineInput);
                        setRepoRankLineInput(parsed?.normalized ?? `+${DEFAULT_REPO_LINE_LIMIT}`);
                      }}
                      placeholder="+8 / -8"
                      aria-label="레포 누적 추이 입력"
                    />
                  )}
                  <Badge color="gray" variant="light">{activeTeamTotalSeries.length}개 팀</Badge>
                </Group>
              </Group>
              {activeTeamTotalSeries.length === 0 ? (
                <Text size="sm" c="dimmed">
                  지정된 시점 범위(2026-02-21 15:00 ~ 2026-02-22 09:00)에 커밋이 있는 팀이 없습니다.
                </Text>
              ) : (
                <div className="battle-team-visual-layout">
                  <div className="battle-team-chart-block">
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
                                seriesByKey={rightChartEntityByKey}
                                unitLabel={teamStackUnitLabel}
                                valueFormatter={teamStackValueFormatter}
                              />
                            }
                          />
                          {teamStackSeries.map((series) => (
                            <Bar
                              key={`team-stack-${series.key}`}
                              dataKey={series.key}
                              stackId={metricMode}
                              fill={series.stroke}
                              isAnimationActive={false}
                            >
                              <LabelList
                                dataKey={series.key}
                                content={(props) => renderTeamSegmentLabel(props, series.label)}
                              />
                              {teamStackRows.map((row, index) => (
                                <Cell
                                  key={`${series.key}-${row?.teamId ?? index}`}
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
                    <Group justify="space-between" align="center" mb={4}>
                      <Text size="xs" c="dimmed" fw={700}>{lineChartTitle}</Text>
                      <Text size="xs" c="dimmed">{lineChartHint}</Text>
                    </Group>
                    <SeriesLegendBoxes series={lineChartSeries} />
                    {!hasLineChartData ? (
                      <Text size="sm" c="dimmed">{lineChartEmptyText}</Text>
                    ) : (
                      <div className="battle-team-line-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                          {isRepoRankMode ? (
                            <AreaChart
                              data={lineChartRows}
                              margin={{ top: 8, right: 10, left: 0, bottom: 2 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                              <XAxis
                                dataKey="index"
                                interval="preserveStartEnd"
                                tickFormatter={(value) => lineChartRows[value]?.shortLabel ?? ''}
                                minTickGap={18}
                                tick={{ fill: chartTickColor, fontSize: 11 }}
                                axisLine={{ stroke: chartAxisStroke }}
                                tickLine={{ stroke: chartAxisStroke }}
                              />
                              <YAxis
                                allowDecimals={!isRepoBattleMode}
                                domain={lineChartDomain}
                                tickFormatter={lineChartYAxisTickFormatter}
                                tick={{ fill: chartTickColor, fontSize: 11 }}
                                axisLine={{ stroke: chartAxisStroke }}
                                tickLine={{ stroke: chartAxisStroke }}
                              />
                              {Number.isFinite(activeLineMarkerIndex) && (
                                <ReferenceLine x={activeLineMarkerIndex} stroke={chartReferenceStroke} strokeWidth={1.6} />
                              )}
                              {(useNetLines || hasNegativeLineValue) && (
                                <ReferenceLine y={0} stroke={chartReferenceStroke} strokeDasharray="4 4" />
                              )}
                              <Tooltip
                                content={
                                  <TeamLineTooltip
                                    seriesByKey={lineChartSeriesByKey}
                                    valueFormatter={lineChartValueFormatter}
                                    showPercent
                                  />
                                }
                              />
                              {lineChartSeries.map((series) => (
                                <Area
                                  key={`battle-area-${series.key}`}
                                  stackId="repo-rank-percent"
                                  type="monotone"
                                  dataKey={series.key}
                                  stroke={series.stroke}
                                  fill={series.stroke}
                                  fillOpacity={0.16}
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                  isAnimationActive={false}
                                />
                              ))}
                            </AreaChart>
                          ) : (
                            <LineChart
                              data={lineChartRows}
                              margin={{ top: 8, right: 10, left: 0, bottom: 2 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                              <XAxis
                                dataKey="index"
                                interval="preserveStartEnd"
                                tickFormatter={(value) => lineChartRows[value]?.shortLabel ?? ''}
                                minTickGap={18}
                                tick={{ fill: chartTickColor, fontSize: 11 }}
                                axisLine={{ stroke: chartAxisStroke }}
                                tickLine={{ stroke: chartAxisStroke }}
                              />
                              <YAxis
                                allowDecimals={!isRepoBattleMode}
                                domain={lineChartDomain}
                                tickFormatter={lineChartYAxisTickFormatter}
                                tick={{ fill: chartTickColor, fontSize: 11 }}
                                axisLine={{ stroke: chartAxisStroke }}
                                tickLine={{ stroke: chartAxisStroke }}
                              />
                              {Number.isFinite(activeLineMarkerIndex) && (
                                <ReferenceLine x={activeLineMarkerIndex} stroke={chartReferenceStroke} strokeWidth={1.6} />
                              )}
                              {(useNetLines || hasNegativeLineValue) && (
                                <ReferenceLine y={0} stroke={chartReferenceStroke} strokeDasharray="4 4" />
                              )}
                              <Tooltip
                                content={
                                  <TeamLineTooltip
                                    seriesByKey={lineChartSeriesByKey}
                                    valueFormatter={lineChartValueFormatter}
                                    showPercent={false}
                                  />
                                }
                              />
                              {lineChartSeries.map((series) => (
                                <Line
                                  key={`battle-line-${series.key}`}
                                  type="monotone"
                                  dataKey={series.key}
                                  stroke={series.stroke}
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                  isAnimationActive={false}
                                />
                              ))}
                            </LineChart>
                          )}
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

      <Modal
        opened={isTeamFilterModalOpen}
        onClose={() => setIsTeamFilterModalOpen(false)}
        title="팀 제거 선택"
        centered
        size="md"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            체크한 팀은 배틀 그래프와 랭킹에서 제외됩니다.
          </Text>
          <Group justify="space-between">
            <Badge color="gray" variant="light">총 {teamFilterOptions.length}개 팀</Badge>
            <Badge color="gray" variant="light">제외 {removedTeamIds.length}개</Badge>
          </Group>
          {teamFilterOptions.length === 0 ? (
            <Text size="sm" c="dimmed">선택 가능한 팀이 없습니다.</Text>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
              <Stack gap={6}>
                {teamFilterOptions.map((teamOption) => (
                  <Checkbox
                    key={`team-filter-${teamOption.id}`}
                    checked={removedTeamIdSet.has(teamOption.id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setRemovedTeamIds((prev) => {
                        if (checked) {
                          if (prev.includes(teamOption.id)) {
                            return prev;
                          }
                          return [...prev, teamOption.id];
                        }
                        return prev.filter((id) => id !== teamOption.id);
                      });
                    }}
                    label={
                      <Group gap={8} wrap="nowrap">
                        <Text size="sm" fw={700}>{teamOption.label}</Text>
                        <Text size="xs" c="dimmed">{teamOption.fileName}</Text>
                      </Group>
                    }
                  />
                ))}
              </Stack>
            </div>
          )}
          <Group justify="space-between">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => setRemovedTeamIds([])}
              disabled={removedTeamIds.length === 0}
            >
              모두 복원
            </Button>
            <Button color={actionButtonColor} onClick={() => setIsTeamFilterModalOpen(false)}>
              닫기
            </Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
}
